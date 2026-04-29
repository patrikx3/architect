import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fsExtra from 'fs-extra';
import { zodToJsonSchema } from './schema.mjs';

const { writeFile, readFile, remove, ensureDir } = fsExtra;

function spawnAndCollect(cmd, args, { input, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
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

        const prompt = system ? `${system}\n\n---\n\n${user}` : user;
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
