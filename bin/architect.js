#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import fsExtra from 'fs-extra';
import { architect } from '../src/orchestrator.mjs';

const { pathExists, readFile } = fsExtra;

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
    .description('DESIGN-ONLY dossier generator — two AIs (Claude + Codex) cross-check to produce a RUP design dossier (conventions, vision, requirements, architecture, file_tree, risks, design-findings). NEVER writes code into your project. The dossier lands under agents/<slug>/. Hand it to your implementer (Claude Code, Cursor, you, your team). Default = pair mode (quick design pass). Add --rup for the full 7-role dossier.')
    .argument('[input]', 'path to a Markdown file containing the requirement (or omit to use --text or stdin)')
    .option('-t, --text <requirement>', 'inline requirement text (alternative to a file)')
    .option('-n, --name <slug>', 'feature slug (folder name under agents/) — derived from input filename if omitted')
    .option('-o, --output <dir>', 'override the output directory (default: <cwd>/agents/<slug>)')
    .option('--rup', 'run the full 7-role RUP design dossier (Inception → Elaboration). Default is the fast pair mode.')
    .option('-b, --budget <usd>', 'cumulative USD budget; 0 = unlimited (CLI subscription mode is $0 anyway)', (v) => Number(v), 5)
    .option('--cwd <dir>', 'project root for the agents/<slug>/ output (defaults to current dir)')
    .action(async (input, opts) => {
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
        const mode = opts.rup ? 'rup' : 'pair';

        try {
            const result = await architect({
                requirement,
                slug,
                outputDir: opts.output,
                projectRoot: cwd,
                mode,
                budgetUsd: opts.budget,
                log: (msg) => console.log(msg),
            });
            console.log('');
            console.log(`✔ design dossier ready (${result.pipelineMode} mode) — ${result.baseDir}`);
            if (result.verdict) console.log(`  verdict:    ${result.verdict}`);
            console.log(`  file_tree:  ${result.fileTree.length} entries`);
            console.log(`  cost:       $${result.usage.totalUsd.toFixed(4)}`);
            console.log('');
            console.log('Next: read the dossier, then implement interactively. p3x-architect does NOT write code.');
        } catch (err) {
            console.error('');
            console.error(`✖ pipeline failed: ${err.message}`);
            if (process.env.ARCHITECT_DEBUG) console.error(err.stack);
            process.exit(1);
        }
    });

await program.parseAsync(process.argv);
