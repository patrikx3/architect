import path from 'node:path';
import fsExtra from 'fs-extra';

import scoutRole from './roles/scout.mjs';
import visionRole from './roles/vision.mjs';
import visionReviewerRole from './roles/vision-reviewer.mjs';
import requirementsAnalystRole from './roles/requirements-analyst.mjs';
import architectRole from './roles/architect.mjs';
import riskAnalystRole from './roles/risk-analyst.mjs';
import designReviewerRole from './roles/design-reviewer.mjs';
import pairPlannerRole from './roles/pair-planner.mjs';
import { logStore, subLogFlush } from './providers/log-context.mjs';
import { scanProject } from './scan-project.mjs';

const { ensureDir, writeFile, readFile, remove, pathExists } = fsExtra;

const writeJson = (filePath, value) => writeFile(filePath, JSON.stringify(value, null, 2));

// p3x-architect is a DESIGN-ONLY tool. The two AIs (Claude + Codex) cross-check
// each other's work across the RUP phases (or a fast pair-mode pre-flight) to
// produce a written dossier — vision, requirements, architecture, file_tree,
// risks, design-findings — that the human + their implementer (Claude Code,
// Cursor, you, your team) then work from. The orchestrator NEVER writes code
// into the project root. It only writes design artifacts under agents/<slug>/.

export async function architect(opts) {
    const log = opts.log ?? (() => {});
    const ctx = { log, buffer: '' };
    return logStore.run(ctx, async () => {
        try {
            const mode = resolveMode(opts);
            if (mode === 'rup') {
                return await runRupArchitect(opts, log);
            }
            return await runPairArchitect(opts, log);
        } finally {
            subLogFlush();
        }
    });
}

// Default is "pair" (quick design pass: scout + plan). Opt into the full RUP
// dossier by passing { mode: 'rup' } or { rup: true }.
function resolveMode(opts) {
    if (opts.mode === 'rup' || opts.mode === 'pair') return opts.mode;
    if (opts.rup === true) return 'rup';
    return 'pair';
}

async function setupRun({
    spec: specInput,
    specPath,
    requirement,
    slug,
    outputDir,
    projectRoot,
    budgetUsd,
}, log) {
    const requirementText = requirement
        ?? specInput
        ?? (specPath ? await readFile(specPath, 'utf8') : null);
    if (!requirementText) {
        throw new Error('requirement, spec, or specPath required');
    }
    if (!outputDir && !slug) {
        throw new Error('outputDir or slug required');
    }
    const root = projectRoot ?? process.cwd();
    const baseDir = outputDir ?? path.join(root, 'agents', slug);
    if (await pathExists(baseDir)) {
        await remove(baseDir);
    }
    await ensureDir(baseDir);

    log(`[scan] reading project root: ${root}`);
    const scan = await scanProject(root);
    log(`[scan] ${scan.files.length} files, ${(scan.totalBytes / 1024).toFixed(1)} KB${scan.truncated ? ' (truncated to fit limits)' : ''}, hasCode=${scan.hasCode}`);
    if (scan.exemplars?.length) {
        log(`[scan] smart-picker added ${scan.exemplars.length} convention exemplars: ${scan.exemplars.slice(0, 8).join(', ')}${scan.exemplars.length > 8 ? ', …' : ''}`);
    }
    if (scan.clusters?.length) {
        const top = scan.clusters.slice(0, 8).map((c) => `${c.key}=${c.size}`).join(', ');
        log(`[scan] top file-name clusters: ${top}${scan.clusters.length > 8 ? ', …' : ''}`);
    }
    if (scan.hasCode) {
        log('[scan] mode: modify-existing — design dossier will describe edits against the current layout');
    } else {
        log('[scan] mode: greenfield — design dossier will describe a fresh project layout');
    }

    const startedAt = new Date();
    let cumulativeUsd = 0;
    const usageLog = [];
    const checkBudget = (label, usage) => {
        cumulativeUsd += usage.usd;
        usageLog.push({ role: label, ...usage });
        log(`[${label}] ${usage.input}+${usage.output} tok, $${usage.usd.toFixed(4)} (cum $${cumulativeUsd.toFixed(4)})`);
        if (budgetUsd > 0 && cumulativeUsd > budgetUsd) {
            throw new Error(`Budget exceeded after ${label}: $${cumulativeUsd.toFixed(4)} > $${budgetUsd}`);
        }
    };

    const runRole = async (label, provider, fn) => {
        const t0 = Date.now();
        log(`[${label}] start (${provider})`);
        const result = await fn();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        log(`[${label}] done in ${elapsed}s`);
        checkBudget(label, result.usage);
        return result;
    };

    return {
        requirementText,
        root,
        baseDir,
        scan,
        startedAt,
        runRole,
        getCumulativeUsd: () => cumulativeUsd,
        usageLog,
    };
}

// ==============================================================
// PAIR mode (default) — quick design pass, 2 AIs:
//   Codex (scout)       — discovers project conventions (existing codebases only)
//   Claude (pair-planner) — drafts plan + file_tree referencing those conventions
// Output: plan.md + file_tree.json (+ conventions.md when there's existing code).
// No code is written. The human / Claude Code implements against the plan.
// ==============================================================

async function runPairArchitect(opts, log) {
    const {
        slug,
        budgetUsd = 5,
    } = opts;

    const setup = await setupRun({ ...opts, budgetUsd }, log);
    const { requirementText, root, baseDir, scan, startedAt, runRole, usageLog } = setup;

    log(`[pipeline] start (pair mode — design only) — slug=${slug ?? '(none)'}, output=${baseDir}`);

    // ---- Step 0: scout (Codex) — discover project conventions ----
    let conventions = '';
    if (scan.hasCode) {
        const scoutResult = await runRole('scout', 'OpenAI/codex',
            () => scoutRole({
                requirement: requirementText,
                existingFiles: scan.files,
                existingPaths: scan.paths,
            }));
        conventions = scoutResult.conventions;
        await writeFile(path.join(baseDir, 'conventions.md'), conventions);
        log(`[scout] discovered categories: ${(scoutResult.detectedCategories || []).join(', ') || '(none)'}`);
    }

    // ---- Step 1: pair-planner (Claude) — plan + file_tree, no content ----
    const planResult = await runRole('pair-planner', 'Claude',
        () => pairPlannerRole({
            requirement: requirementText,
            existingFiles: scan.files,
            existingPaths: scan.paths,
            conventions,
        }));
    const { plan, fileTree } = planResult;
    const planCreate = fileTree.filter((e) => e.mode === 'create').length;
    const planModify = fileTree.filter((e) => e.mode === 'modify').length;
    log(`[pair-planner] file_tree: ${fileTree.length} entries (${planCreate} create, ${planModify} modify)`);
    await writeFile(path.join(baseDir, 'plan.md'), plan);
    await writeJson(path.join(baseDir, 'file_tree.json'), fileTree);

    const finishedAt = new Date();
    const elapsedSec = ((finishedAt - startedAt) / 1000).toFixed(1);
    const cumulativeUsd = setup.getCumulativeUsd();
    const mode = scan.hasCode ? 'modify-existing' : 'greenfield';

    const readme = renderPairReadme({
        slug,
        requirement: requirementText,
        startedAt,
        finishedAt,
        elapsedSec,
        cumulativeUsd,
        fileTreeCount: fileTree.length,
        planCreate,
        planModify,
        mode,
        projectRoot: root,
    });
    await writeFile(path.join(baseDir, 'README.md'), readme);

    await writeJson(path.join(baseDir, 'pipeline.json'), {
        slug,
        pipelineMode: 'pair',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedSec: Number(elapsedSec),
        totalUsd: cumulativeUsd,
        projectRoot: root,
        mode,
        fileTreeCount: fileTree.length,
        planCreate,
        planModify,
        roles: usageLog,
    });

    log(`[done] pair mode — design dossier ready at ${baseDir} — $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s`);

    return {
        baseDir,
        projectRoot: root,
        fileTree,
        mode,
        pipelineMode: 'pair',
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderPairReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, fileTreeCount, planCreate, planModify, mode, projectRoot }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — **pair mode** (quick design pass, 2 AIs).
> This is a **design dossier only**. No code was written into \`${projectRoot}\`.
> Hand the dossier to your implementer (Claude Code, Cursor, you, your team).
> For a full RUP dossier (vision, requirements, architecture, risks, findings),
> re-run with \`--rup\`.

## Original requirement

\`\`\`
${reqExcerpt}
\`\`\`

## Pipeline summary

| Field | Value |
| --- | --- |
| Pipeline mode | **pair** (design-only — fast) |
| Started | ${startedAt.toISOString()} |
| Finished | ${finishedAt.toISOString()} |
| Elapsed | ${elapsedSec}s |
| Total cost | \$${cumulativeUsd.toFixed(4)} |
| Target mode | **${mode}** |
| File-tree entries | ${fileTreeCount} (${planCreate} create, ${planModify} modify) |

## Role split

- **Codex (scout)** — discovers project conventions and emits [conventions.md](conventions.md) (skipped on greenfield).
- **Claude (pair-planner)** — drafts [plan.md](plan.md) and [file_tree.json](file_tree.json) using those conventions.
- **You / your implementer** — read the dossier, build the actual code interactively.

## Outputs

- [plan.md](plan.md) — Claude planner's rationale (greenfield vs modify, layout choices, what each file does)
- [file_tree.json](file_tree.json) — per-file path + purpose + change_notes for the implementer
- [conventions.md](conventions.md) — scout's project-convention notes (existing codebases only)

## Next steps

1. Read [plan.md](plan.md) to confirm the planner understood the requirement.
2. Hand [plan.md](plan.md) + [file_tree.json](file_tree.json) (+ [conventions.md](conventions.md) if present) to your implementer.
3. Implement interactively. Test. Iterate.
4. If the change is large enough to warrant vision / requirements / risks / design-findings, re-run with \`--rup\` instead.

## Pipeline metadata

See [pipeline.json](pipeline.json) for per-role token usage and timing.
`;
}

// ==============================================================
// RUP mode (--rup) — full multi-agent design dossier, 7 roles, 2 AIs.
//   Inception:    scout (Codex), vision (Codex), vision-reviewer (Claude)
//   Elaboration:  requirements-analyst (Codex), architect (Claude),
//                 risk-analyst (Codex), design-reviewer (Claude)
// Output: full dossier under agents/<slug>/{inception,elaboration}/.
// No code is written. The human / Claude Code implements against the dossier.
// ==============================================================

async function runRupArchitect(opts, log) {
    const {
        slug,
        budgetUsd = 5,
    } = opts;

    const setup = await setupRun({ ...opts, budgetUsd }, log);
    const { requirementText, root, baseDir, scan, startedAt, runRole, usageLog } = setup;

    const dirs = {
        inception: path.join(baseDir, 'inception'),
        elaboration: path.join(baseDir, 'elaboration'),
    };
    for (const d of Object.values(dirs)) await ensureDir(d);

    log(`[pipeline] start (rup mode — design dossier) — slug=${slug ?? '(none)'}, output=${baseDir}`);

    // ==================== Phase 1: Inception ====================
    log('[phase] 1/2 inception');

    let conventions = '';
    if (scan.hasCode) {
        const scoutResult = await runRole('scout', 'OpenAI/codex',
            () => scoutRole({
                requirement: requirementText,
                existingFiles: scan.files,
                existingPaths: scan.paths,
            }));
        conventions = scoutResult.conventions;
        await writeFile(path.join(dirs.inception, 'conventions.md'), conventions);
        log(`[scout] discovered categories: ${(scoutResult.detectedCategories || []).join(', ') || '(none)'}`);
    }

    const visionDraft = await runRole('vision', 'OpenAI/codex',
        () => visionRole({ requirement: requirementText }));

    const visionFinal = await runRole('vision-reviewer', 'Claude',
        () => visionReviewerRole({ requirement: requirementText, vision: visionDraft.vision }));

    const vision = visionFinal.vision;
    await writeFile(path.join(dirs.inception, 'vision.md'), vision);
    await writeFile(path.join(dirs.inception, 'vision-review-notes.md'), visionFinal.notes);
    log('[phase] 1/2 inception complete');

    // ==================== Phase 2: Elaboration ====================
    log('[phase] 2/2 elaboration');
    const reqs = await runRole('requirements-analyst', 'OpenAI/codex',
        () => requirementsAnalystRole({ vision }));
    await writeJson(path.join(dirs.elaboration, 'requirements.json'), reqs.requirements);

    const arch = await runRole('architect', 'Claude',
        () => architectRole({
            vision,
            requirements: reqs.requirements,
            existingFiles: scan.files,
            existingPaths: scan.paths,
            conventions,
        }));
    await writeFile(path.join(dirs.elaboration, 'architecture.md'), arch.architecture);
    await writeJson(path.join(dirs.elaboration, 'file_tree.json'), arch.fileTree);
    const createCount = arch.fileTree.filter((e) => e.mode === 'create').length;
    const modifyCount = arch.fileTree.filter((e) => e.mode === 'modify').length;
    log(`[architect] file tree: ${arch.fileTree.length} entries (${createCount} create, ${modifyCount} modify)`);

    const risk = await runRole('risk-analyst', 'OpenAI/codex',
        () => riskAnalystRole({ vision, requirements: reqs.requirements, architecture: arch.architecture }));
    await writeFile(
        path.join(dirs.elaboration, 'risks.md'),
        `# Risks\n\n## Summary\n\n${risk.summary}\n\n## Risk register\n\n\`\`\`json\n${JSON.stringify(risk.risks, null, 2)}\n\`\`\`\n`,
    );

    const designReview = await runRole('design-reviewer', 'Claude',
        () => designReviewerRole({
            vision,
            requirements: reqs.requirements,
            architecture: arch.architecture,
            fileTree: arch.fileTree,
            risks: risk.risks,
        }));
    await writeFile(path.join(dirs.elaboration, 'design-review.md'), designReview.review);
    await writeJson(path.join(dirs.elaboration, 'design-findings.json'), designReview.findings);
    log(`[design-reviewer] verdict: ${designReview.verdict}`);
    log('[phase] 2/2 elaboration complete');

    // ==================== Top-level README ====================
    const finishedAt = new Date();
    const elapsedSec = ((finishedAt - startedAt) / 1000).toFixed(1);
    const cumulativeUsd = setup.getCumulativeUsd();
    const mode = scan.hasCode ? 'modify-existing' : 'greenfield';
    const readme = renderRupReadme({
        slug,
        requirement: requirementText,
        startedAt,
        finishedAt,
        elapsedSec,
        cumulativeUsd,
        verdict: designReview.verdict,
        fileTreeCount: arch.fileTree.length,
        createCount,
        modifyCount,
        mode,
        projectRoot: root,
    });
    await writeFile(path.join(baseDir, 'README.md'), readme);

    await writeJson(path.join(baseDir, 'pipeline.json'), {
        slug,
        pipelineMode: 'rup',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedSec: Number(elapsedSec),
        totalUsd: cumulativeUsd,
        verdict: designReview.verdict,
        projectRoot: root,
        mode,
        fileTreeCount: arch.fileTree.length,
        createCount,
        modifyCount,
        roles: usageLog,
    });

    log(`[done] rup mode — design dossier ready at ${baseDir} — $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s`);

    return {
        baseDir,
        projectRoot: root,
        fileTree: arch.fileTree,
        mode,
        verdict: designReview.verdict,
        findings: designReview.findings,
        pipelineMode: 'rup',
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderRupReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, verdict, fileTreeCount, createCount, modifyCount, mode, projectRoot }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — **RUP mode** (full design dossier, 2 AIs cross-checking).
> This is a **design dossier only**. No code was written into \`${projectRoot}\`.
> Hand the dossier to your implementer (Claude Code, Cursor, you, your team).

## Original requirement

\`\`\`
${reqExcerpt}
\`\`\`

## Pipeline summary

| Field | Value |
| --- | --- |
| Pipeline mode | **rup** (design-only — full dossier, 7 roles) |
| Started | ${startedAt.toISOString()} |
| Finished | ${finishedAt.toISOString()} |
| Elapsed | ${elapsedSec}s |
| Total cost | \$${cumulativeUsd.toFixed(4)} |
| Target mode | **${mode}** |
| File-tree entries | ${fileTreeCount} (${createCount} create, ${modifyCount} modify) |
| Design verdict | **${verdict}** |

## Outputs (design dossier)

### Phase 1 — Inception
- [conventions.md](inception/conventions.md) — scout's project-convention notes (existing codebases only)
- [vision.md](inception/vision.md) — purpose, stakeholders, success criteria, scope, use cases
- [vision-review-notes.md](inception/vision-review-notes.md) — what the reviewer changed and why

### Phase 2 — Elaboration
- [requirements.json](elaboration/requirements.json) — structured, prioritized requirements
- [architecture.md](elaboration/architecture.md) — components, tech choices, data flow
- [file_tree.json](elaboration/file_tree.json) — every file the architect proposed (mode: create / modify + change_notes)
- [risks.md](elaboration/risks.md) — risk register with mitigations
- [design-review.md](elaboration/design-review.md) — Elaboration sign-off + verdict
- [design-findings.json](elaboration/design-findings.json) — specific gaps for the implementer to address

## Next steps

1. Read [inception/vision.md](inception/vision.md) to confirm the agents understood the spec.
2. Skim [elaboration/architecture.md](elaboration/architecture.md) + [elaboration/file_tree.json](elaboration/file_tree.json) to confirm the design.
3. Address every issue in [elaboration/design-findings.json](elaboration/design-findings.json) — they're the reviewer's blocker list.
4. Hand the dossier to your implementer (Claude Code, Cursor, you, your team). Implement interactively. Test. Iterate.

## Pipeline metadata

See [pipeline.json](pipeline.json) for full per-role token usage + timing.
`;
}
