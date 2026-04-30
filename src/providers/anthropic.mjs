import { spawn } from 'node:child_process';
import { zodToJsonSchema } from './schema.mjs';
import { subLog } from './log-context.mjs';

// Maps Anthropic model IDs (used in CLAUDE.md / .env) to claude CLI --model values.
// claude CLI accepts aliases ('opus', 'sonnet', 'haiku') or full IDs.
function resolveModel(model) {
    if (!model) return 'opus';
    if (/^(opus|sonnet|haiku)$/i.test(model)) return model.toLowerCase();
    if (model.startsWith('claude-opus')) return 'opus';
    if (model.startsWith('claude-sonnet')) return 'sonnet';
    if (model.startsWith('claude-haiku')) return 'haiku';
    return model;
}

function spawnAndCollect(cmd, args, { input } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        // stdout is the structured JSON envelope — just capture, don't surface to user.
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        // stderr is claude CLI progress / status — forward each line live to the
        // active log channel (CLI console or MCP notifications).
        child.stderr.on('data', (d) => {
            const s = d.toString();
            stderr += s;
            subLog(`  ↳ claude: ${s}`);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                const msg = stderr.trim() || stdout.trim() || `${cmd} exited ${code}`;
                reject(new Error(`${cmd} exited ${code}: ${msg.slice(0, 1000)}`));
                return;
            }
            resolve({ stdout, stderr });
        });
        if (input != null) child.stdin.write(input);
        child.stdin.end();
    });
}

export async function callAnthropic({ system, user, schema, schemaName, model = process.env.ANTHROPIC_MODEL || 'opus' }) {
    const cliModel = resolveModel(model);
    const jsonSchema = JSON.stringify(zodToJsonSchema(schema));

    const args = [
        '--print',
        '--output-format', 'json',
        '--json-schema', jsonSchema,
        '--model', cliModel,
        '--exclude-dynamic-system-prompt-sections',
    ];
    if (system) args.push('--system-prompt', system);

    const { stdout } = await spawnAndCollect('claude', args, { input: user });

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
