import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fsExtra from 'fs-extra';
import { zodToJsonSchema } from './schema.mjs';
import { subLog } from './log-context.mjs';

const { writeFile, readFile, remove, ensureDir } = fsExtra;

function spawnAndCollect(cmd, args, { input, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
        let stdout = '';
        let stderr = '';
        // codex exec's structured result is captured via --output-last-message file,
        // so stdout here is the live agent transcript (thinking, tool calls). Forward
        // every line of stdout AND stderr to the active log channel so the user sees
        // codex working — never goes silent for minutes.
        child.stdout.on('data', (d) => {
            const s = d.toString();
            stdout += s;
            subLog(`  ↳ codex: ${s}`);
        });
        child.stderr.on('data', (d) => {
            const s = d.toString();
            stderr += s;
            subLog(`  ↳ codex: ${s}`);
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

// codex exec subscription mode does not accept gpt-5/4o family directly — it picks
// up the ChatGPT-account-tier model automatically (gpt-5.5 as of 2026-04). The
// process.env.OPENAI_MODEL value is now an advisory hint logged in usage; codex itself
// chooses the model. If the user wants to force one, they can set CODEX_MODEL and we'll
// pass --model.
export async function callOpenAI({ system, user, schema, schemaName, model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
    const tmpDir = path.join(os.tmpdir(), `p3x-architect-${process.pid}-${Date.now()}`);
    await ensureDir(tmpDir);
    const schemaPath = path.join(tmpDir, 'schema.json');
    const resultPath = path.join(tmpDir, 'result.txt');

    try {
        await writeFile(schemaPath, JSON.stringify(zodToJsonSchema(schema)));

        // Defensive: strip null bytes from the prompt. spawn() refuses any arg
        // containing a null byte (ERR_INVALID_ARG_VALUE). Scanning filters most
        // of these out via isLikelyBinary, but if a binary file slips through
        // we'd rather drop the byte than kill the whole run.
        const rawPrompt = system ? `${system}\n\n---\n\n${user}` : user;
        const prompt = typeof rawPrompt === 'string' ? rawPrompt.replace(/\0/g, '') : rawPrompt;
        const args = [
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--output-schema', schemaPath,
            '--output-last-message', resultPath,
        ];
        if (process.env.CODEX_MODEL) {
            args.push('--model', process.env.CODEX_MODEL);
        }
        args.push(prompt);

        await spawnAndCollect('codex', args);

        const raw = (await readFile(resultPath, 'utf8')).trim();
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            throw new Error(`codex output was not valid JSON. First 500 chars:\n${raw.slice(0, 500)}`);
        }

        const data = schema.parse(parsed);

        return {
            data,
            usage: {
                input: 0,
                output: 0,
                usd: 0, // subscription — no per-call cost
                model: process.env.CODEX_MODEL || model,
                provider: 'codex-cli',
            },
        };
    } finally {
        await remove(tmpDir).catch(() => {});
    }
}
