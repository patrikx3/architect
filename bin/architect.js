#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Command } from 'commander';
import fsExtra from 'fs-extra';
import { architect } from '../src/orchestrator.mjs';

const { pathExists, readFile } = fsExtra;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function loadEnvFile(envPath) {
    if (!(await pathExists(envPath))) return false;
    const content = await readFile(envPath, 'utf8');
    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    }
    return true;
}

async function loadEnv() {
    const candidates = [
        path.join(projectRoot, 'secure', '.env'),
        path.join(projectRoot, 'secure', '.env.architect'),
    ];
    for (const c of candidates) {
        if (await loadEnvFile(c)) return c;
    }
    return null;
}

async function readStdin() {
    if (process.stdin.isTTY) return null;
    let data = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) data += chunk;
    return data.trim() || null;
}

function slugify(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'unnamed';
}

const program = new Command();

program
    .name('p3x-architect')
    .description('Multi-agent RUP pipeline (OpenAI + Claude) — generates a full design and an implementation under agents/<slug>/.')
    .argument('[input]', 'path to a Markdown file containing the requirement (or omit to use --text or stdin)')
    .option('-t, --text <requirement>', 'inline requirement text (alternative to a file)')
    .option('-n, --name <slug>', 'feature slug (folder name under agents/) — derived from input filename if omitted')
    .option('-o, --output <dir>', 'override the output directory (default: <cwd>/agents/<slug>)')
    .option('-r, --max-rounds <n>', 'maximum critic↔reviser rounds in Construction', (v) => Number(v), 2)
    .option('-b, --budget <usd>', 'cumulative USD budget; 0 = unlimited', (v) => Number(v), 5)
    .option('--cwd <dir>', 'project root for the agents/<slug>/ output (defaults to current dir)')
    .action(async (input, opts) => {
        await loadEnv();

        let requirement = opts.text;
        let derivedName = null;

        if (input) {
            if (!(await pathExists(input))) {
                console.error(`Input file not found: ${input}`);
                process.exit(2);
            }
            requirement = await readFile(input, 'utf8');
            derivedName = path.basename(input, path.extname(input));
        } else if (!requirement) {
            const stdinText = await readStdin();
            if (stdinText) {
                requirement = stdinText;
            }
        }

        if (!requirement) {
            console.error('No requirement provided. Pass a file path, --text "...", or pipe via stdin.');
            process.exit(2);
        }

        const slug = opts.name ?? (derivedName ? slugify(derivedName) : slugify(requirement.slice(0, 40)));
        const cwd = opts.cwd ?? process.cwd();

        try {
            const result = await architect({
                requirement,
                slug,
                outputDir: opts.output,
                projectRoot: cwd,
                maxRounds: opts.maxRounds,
                budgetUsd: opts.budget,
                log: (msg) => console.log(msg),
            });
            console.log('');
            console.log(`✔ done — ${result.baseDir}`);
            console.log(`  verdict: ${result.verdict}`);
            console.log(`  files:   ${result.files.length}`);
            console.log(`  cost:    $${result.usage.totalUsd.toFixed(4)}`);
        } catch (err) {
            console.error('');
            console.error(`✖ pipeline failed: ${err.message}`);
            if (process.env.ARCHITECT_DEBUG) console.error(err.stack);
            process.exit(1);
        }
    });

await program.parseAsync(process.argv);
