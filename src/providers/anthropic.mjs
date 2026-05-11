import { spawn } from 'node:child_process';
import { zodToJsonSchema } from './schema.mjs';
import { subLog } from './log-context.mjs';

// Default to the 1M-context Opus variant so real codebases (scan + conventions
// + intermediate artifacts) fit without role-level prompt truncation. The plain
// 'opus' alias still resolves to the standard 200k variant — only the unspecified
// case picks 1M. Set ANTHROPIC_MODEL=opus to keep 200k behaviour.
const DEFAULT_MODEL = 'claude-opus-4-7[1m]';

// Maps Anthropic model IDs (used in CLAUDE.md / .env) to claude CLI --model values.
// claude CLI accepts aliases ('opus', 'sonnet', 'haiku') or full IDs.
function resolveModel(model) {
    if (!model) return DEFAULT_MODEL;
    if (/^(opus|sonnet|haiku)$/i.test(model)) return model.toLowerCase();
    // Pass through full model IDs (incl. context-variant suffixes like [1m]).
    if (model.startsWith('claude-')) return model;
    return model;
}

// Per-call subprocess timeout. Without this, a stuck claude/codex call can run
// for hours (no internal cap in the CLI either). 15 min is enough for a heavy
// implementer/reviewer with 1M context, but short enough that a hang doesn't
// burn the user's afternoon.
const SUBPROCESS_TIMEOUT_MS = Number(process.env.ARCHITECT_SUBPROCESS_TIMEOUT_MS ?? 15 * 60 * 1000);

function spawnAndCollect(cmd, args, { input } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const settle = (fn) => (val) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            fn(val);
        };
        const timer = SUBPROCESS_TIMEOUT_MS > 0
            ? setTimeout(() => {
                if (settled) return;
                subLog(`  ↳ claude: ⏱ timeout after ${SUBPROCESS_TIMEOUT_MS / 1000}s — killing subprocess`);
                child.kill('SIGTERM');
                setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
                settle(reject)(new Error(`${cmd} timed out after ${SUBPROCESS_TIMEOUT_MS / 1000}s`));
            }, SUBPROCESS_TIMEOUT_MS)
            : null;
        // stdout is the structured JSON envelope — just capture, don't surface to user.
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        // stderr is claude CLI progress / status — forward each line live to the
        // active log channel (CLI console or MCP notifications).
        child.stderr.on('data', (d) => {
            const s = d.toString();
            stderr += s;
            subLog(`  ↳ claude: ${s}`);
        });
        child.on('error', settle(reject));
        child.on('close', (code) => {
            if (settled) return;
            if (code !== 0) {
                const msg = stderr.trim() || stdout.trim() || `${cmd} exited ${code}`;
                settle(reject)(new Error(`${cmd} exited ${code}: ${msg.slice(0, 1000)}`));
                return;
            }
            settle(resolve)({ stdout, stderr });
        });
        if (input != null) child.stdin.write(input);
        child.stdin.end();
    });
}

export async function callAnthropic({ system, user, schema, schemaName, model = process.env.ANTHROPIC_MODEL }) {
    const cliModel = resolveModel(model);
    const jsonSchema = JSON.stringify(zodToJsonSchema(schema));

    const args = [
        '--print',
        '--output-format', 'json',
        '--json-schema', jsonSchema,
        '--model', cliModel,
        '--exclude-dynamic-system-prompt-sections',
    ];
    // Defensive: strip null bytes. spawn() refuses any arg containing a null
    // byte (the `system` prompt is an arg). The `user` text is piped via stdin
    // so it isn't subject to the same restriction, but we scrub both to keep
    // behaviour symmetric with the openai provider.
    const safeSystem = typeof system === 'string' ? system.replace(/\0/g, '') : system;
    const safeUser = typeof user === 'string' ? user.replace(/\0/g, '') : user;
    if (safeSystem) args.push('--system-prompt', safeSystem);

    const { stdout } = await spawnAndCollect('claude', args, { input: safeUser });

    let envelope;
    try {
        envelope = JSON.parse(stdout);
    } catch (err) {
        throw new Error(`claude CLI returned non-JSON output (first 500 chars): ${stdout.slice(0, 500)}`);
    }

    if (envelope.is_error || envelope.subtype !== 'success') {
        throw new Error(`claude CLI error: ${envelope.api_error_status ?? envelope.subtype} — ${envelope.result?.slice?.(0, 500) ?? ''}`);
    }

    const raw = envelope.structured_output;
    if (raw == null) {
        throw new Error(`claude CLI gave no structured_output. Raw result: ${envelope.result?.slice?.(0, 500) ?? '(empty)'}`);
    }
    const data = schema.parse(raw);

    const u = envelope.usage ?? {};
    const usage = {
        input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
        usd: 0, // subscription — no per-call cost
        model: cliModel,
        provider: 'claude-cli',
    };

    return { data, usage };
}
