import path from 'node:path';
import fsExtra from 'fs-extra';

import visionRole from './roles/vision.mjs';
import visionReviewerRole from './roles/vision-reviewer.mjs';
import requirementsAnalystRole from './roles/requirements-analyst.mjs';
import architectRole from './roles/architect.mjs';
import riskAnalystRole from './roles/risk-analyst.mjs';
import designReviewerRole from './roles/design-reviewer.mjs';
import implementerRole from './roles/implementer.mjs';
import criticRole from './roles/critic.mjs';
import reviserRole from './roles/reviser.mjs';
import acceptanceWriterRole from './roles/acceptance-writer.mjs';
import deploymentWriterRole from './roles/deployment-writer.mjs';
import pairPlannerRole from './roles/pair-planner.mjs';
import pairImplementerRole from './roles/pair-implementer.mjs';
import pairReviewerRole from './roles/pair-reviewer.mjs';
import pairReviserRole from './roles/pair-reviser.mjs';
import { logStore, subLogFlush } from './providers/log-context.mjs';
import { scanProject } from './scan-project.mjs';

const { ensureDir, writeFile, readFile, remove, pathExists } = fsExtra;

const isBlocking = (issue) => issue.severity === 'high' || issue.severity === 'medium';

// Resolve a tree-relative path against projectRoot, blocking absolute paths and
// any '..' component so the AI cannot escape projectRoot. Throws on violations.
const resolveSafe = (projectRoot, relPath) => {
    if (!relPath || typeof relPath !== 'string') {
        throw new Error(`bad file path from role: ${relPath}`);
    }
    if (path.isAbsolute(relPath)) {
        throw new Error(`refusing absolute path from role: ${relPath}`);
    }
    const normalized = path.normalize(relPath);
    if (normalized.split(/[\\/]/).includes('..')) {
        throw new Error(`refusing path that escapes project root: ${relPath}`);
    }
    return path.join(projectRoot, normalized);
};

const writeProjectFiles = async (projectRoot, files, log) => {
    for (const file of files) {
        const target = resolveSafe(projectRoot, file.path);
        await ensureDir(path.dirname(target));
        await writeFile(target, file.content);
        log?.(`  ↳ wrote ${file.mode === 'modify' ? 'modify' : 'create'}: ${file.path}`);
    }
};

const mergeFiles = (current, updated) => {
    const map = new Map(current.map((f) => [f.path, f]));
    for (const file of updated) {
        map.set(file.path, file);
    }
    return Array.from(map.values());
};

const writeJson = (filePath, value) => writeFile(filePath, JSON.stringify(value, null, 2));

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

// Default is "pair" (Claude implements + Codex critiques, optional Claude revise).
// Opt into "rup" by passing { mode: 'rup' } or { rup: true }.
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
    if (scan.hasCode) {
        log('[scan] mode: modify-in-place — roles will see existing code and only change what the feature needs');
    } else {
        log('[scan] mode: greenfield — roles will create a new project at the root');
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
// PAIR mode (default) — 1 task, 2 AIs, fixed role split:
//   Claude  = architect / planner / reviewer / risk checker  (NEVER writes file content)
//   Codex   = implementer / refactor / test writer            (NEVER plans architecture)
//   Human   = final architect + approval authority
// Pipeline:
//   1. pair-planner    (Claude) → plan + file_tree (no content)
//   2. pair-implementer (Codex) → full content for every file in the tree
//   3. pair-reviewer   (Claude) → issues list
//   4. pair-reviser    (Codex)  → revised files (only if blocking issues + rounds left)
// ==============================================================

async function runPairArchitect(opts, log) {
    const {
        slug,
        maxRounds = 1,
        budgetUsd = 5,
    } = opts;

    const setup = await setupRun({ ...opts, budgetUsd }, log);
    const { requirementText, root, baseDir, scan, startedAt, runRole, usageLog } = setup;

    log(`[pipeline] start (pair mode) — slug=${slug ?? '(none)'}, output=${baseDir}`);

    // ---- Step 1: pair-planner (Claude) — plan + file_tree, no content ----
    const planResult = await runRole('pair-planner', 'Claude',
        () => pairPlannerRole({
            requirement: requirementText,
            existingFiles: scan.files,
            existingPaths: scan.paths,
        }));
    const { plan, fileTree } = planResult;
    const planCreate = fileTree.filter((e) => e.mode === 'create').length;
    const planModify = fileTree.filter((e) => e.mode === 'modify').length;
    log(`[pair-planner] file_tree: ${fileTree.length} entries (${planCreate} create, ${planModify} modify)`);
    await writeFile(path.join(baseDir, 'plan.md'), plan);
    await writeJson(path.join(baseDir, 'file_tree.json'), fileTree);

    // ---- Step 2: pair-implementer (Codex) — write every file from the plan ----
    const impl = await runRole('pair-implementer', 'OpenAI/codex',
        () => pairImplementerRole({
            requirement: requirementText,
            plan,
            fileTree,
            existingFiles: scan.files,
        }));
    let files = impl.files;
    log(`[pair-implementer] produced ${files.length} files`);
    await writeProjectFiles(root, files, log);

    // ---- Step 3..N: pair-reviewer (Claude) ↔ pair-reviser (Codex) ----
    let lastIssues = [];
    for (let round = 1; round <= maxRounds; round += 1) {
        const review = await runRole(`pair-reviewer-r${round}`, 'Claude',
            () => pairReviewerRole({ requirement: requirementText, plan, files }));
        lastIssues = review.issues;
        await writeJson(path.join(baseDir, `issues-round-${round}.json`), review.issues);

        const blocking = review.issues.filter(isBlocking);
        log(`[pair-reviewer-r${round}] ${review.issues.length} issues, ${blocking.length} blocking`);

        if (blocking.length === 0) {
            log(`[pair-reviewer-r${round}] no blocking issues — stopping review loop`);
            break;
        }
        if (round >= maxRounds) {
            log(`[pair-reviewer-r${round}] max rounds reached, ${blocking.length} blocking issues remain`);
            break;
        }

        const rev = await runRole(`pair-reviser-r${round}`, 'OpenAI/codex',
            () => pairReviserRole({ requirement: requirementText, plan, files, issues: review.issues }));
        files = mergeFiles(files, rev.files);
        await writeProjectFiles(root, rev.files, log);
        log(`[pair-reviser-r${round}] revised ${rev.files.length} files`);
    }

    const changesManifest = {
        projectRoot: root,
        mode: scan.hasCode ? 'modify-in-place' : 'greenfield',
        existingFilesScanned: scan.files.length,
        created: files.filter((f) => f.mode === 'create').map((f) => f.path).sort(),
        modified: files.filter((f) => f.mode === 'modify').map((f) => f.path).sort(),
    };
    await writeJson(path.join(baseDir, 'changes.json'), changesManifest);

    const finishedAt = new Date();
    const elapsedSec = ((finishedAt - startedAt) / 1000).toFixed(1);
    const cumulativeUsd = setup.getCumulativeUsd();
    const remainingBlocking = lastIssues.filter(isBlocking).length;

    const readme = renderPairReadme({
        slug,
        requirement: requirementText,
        startedAt,
        finishedAt,
        elapsedSec,
        cumulativeUsd,
        fileCount: files.length,
        createdCount: changesManifest.created.length,
        modifiedCount: changesManifest.modified.length,
        mode: changesManifest.mode,
        projectRoot: root,
        roundsRun: usageLog.filter((u) => u.role.startsWith('pair-reviewer-r')).length,
        remainingBlocking,
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
        mode: changesManifest.mode,
        fileCount: files.length,
        created: changesManifest.created,
        modified: changesManifest.modified,
        remainingBlockingIssues: remainingBlocking,
        roles: usageLog,
    });

    log(`[done] pair mode — $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s — design: ${baseDir}, code: ${root}`);

    return {
        baseDir,
        projectRoot: root,
        files,
        created: changesManifest.created,
        modified: changesManifest.modified,
        mode: changesManifest.mode,
        verdict: remainingBlocking === 0 ? 'ready-to-build' : 'fix-then-build',
        issues: lastIssues,
        pipelineMode: 'pair',
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderPairReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, fileCount, createdCount, modifiedCount, mode, projectRoot, roundsRun, remainingBlocking }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — **pair mode** (Claude implements + Codex critiques).
> The actual code was written / modified directly under the project root: \`${projectRoot}\`.
> Review it with \`git diff\`. For a full RUP design dossier, re-run with \`--rup\`.

## Original requirement

\`\`\`
${reqExcerpt}
\`\`\`

## Pipeline summary

| Field | Value |
| --- | --- |
| Pipeline mode | **pair** (fast, 2-3 calls) |
| Started | ${startedAt.toISOString()} |
| Finished | ${finishedAt.toISOString()} |
| Elapsed | ${elapsedSec}s |
| Total cost | \$${cumulativeUsd.toFixed(4)} |
| Mode | **${mode}** |
| Files touched | ${fileCount} (${createdCount} created, ${modifiedCount} modified) |
| Critic rounds | ${roundsRun} |
| Remaining blocking issues | ${remainingBlocking} |

## Role split (1 task / 2 AI workflow)

- **Claude** — architect, planner, reviewer, risk checker. Wrote [plan.md](plan.md) and the issues lists.
- **Codex** — implementer, refactoring, test writer. Wrote every file under the project root.
- **You** — final architect + approval authority.

## Outputs

- [plan.md](plan.md) — Claude planner's rationale (greenfield vs modify, layout choices, what each file does)
- [file_tree.json](file_tree.json) — what Claude planned for Codex to implement
- [changes.json](changes.json) — manifest of created vs. modified files at the project root
- \`issues-round-N.json\` — Claude reviewer findings per round (empty file = no issues)

## Next steps

1. \`git status\` / \`git diff\` at the project root — review every file the pair touched.
2. Read [plan.md](plan.md) to confirm Claude understood the requirement.
3. If you need a deeper design dossier (vision, requirements, architecture, risks, acceptance, deploy), re-run with \`--rup\`.

## Pipeline metadata

See [pipeline.json](pipeline.json) for full per-role token usage, cost, and the same created/modified manifest.
`;
}

// ==============================================================
// RUP mode (--rup) — full 11-role, 4-phase pipeline. Use this when designing
// something complex enough to warrant the design dossier.
// ==============================================================

async function runRupArchitect(opts, log) {
    const {
        slug,
        maxRounds = 2,
        budgetUsd = 5,
    } = opts;

    const setup = await setupRun({ ...opts, budgetUsd }, log);
    const { requirementText, root, baseDir, scan, startedAt, runRole, usageLog } = setup;

    const dirs = {
        inception: path.join(baseDir, 'inception'),
        elaboration: path.join(baseDir, 'elaboration'),
        construction: path.join(baseDir, 'construction'),
        transition: path.join(baseDir, 'transition'),
    };
    for (const d of Object.values(dirs)) await ensureDir(d);

    log(`[pipeline] start (rup mode) — slug=${slug ?? '(none)'}, output=${baseDir}`);

    // ==================== Phase 1: Inception ====================
    log('[phase] 1/4 inception');
    const visionDraft = await runRole('vision', 'OpenAI/codex',
        () => visionRole({ requirement: requirementText }));

    const visionFinal = await runRole('vision-reviewer', 'Claude',
        () => visionReviewerRole({ requirement: requirementText, vision: visionDraft.vision }));

    const vision = visionFinal.vision;
    await writeFile(path.join(dirs.inception, 'vision.md'), vision);
    await writeFile(path.join(dirs.inception, 'vision-review-notes.md'), visionFinal.notes);
    log('[phase] 1/4 inception complete');

    // ==================== Phase 2: Elaboration ====================
    log('[phase] 2/4 elaboration');
    const reqs = await runRole('requirements-analyst', 'OpenAI/codex',
        () => requirementsAnalystRole({ vision }));
    await writeJson(path.join(dirs.elaboration, 'requirements.json'), reqs.requirements);

    const arch = await runRole('architect', 'Claude',
        () => architectRole({
            vision,
            requirements: reqs.requirements,
            existingFiles: scan.files,
            existingPaths: scan.paths,
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
    log('[phase] 2/4 elaboration complete');

    // ==================== Phase 3: Construction ====================
    log(`[phase] 3/4 construction (${arch.fileTree.length} entries — ${createCount} create / ${modifyCount} modify, target=${root})`);
    const impl = await runRole('implementer', 'Claude',
        () => implementerRole({
            spec: vision,
            requirements: reqs.requirements,
            architecture: arch.architecture,
            fileTree: arch.fileTree,
            existingFiles: scan.files,
        }));
    let files = impl.files;
    await writeProjectFiles(root, files, log);
    log(`[implementer] applied ${files.length} files to ${root}`);

    let lastIssues = [];
    for (let round = 1; round <= maxRounds; round += 1) {
        const review = await runRole(`critic-r${round}`, 'OpenAI/codex',
            () => criticRole({
                spec: vision,
                requirements: reqs.requirements,
                architecture: arch.architecture,
                files,
            }));
        lastIssues = review.issues;
        await writeJson(
            path.join(dirs.construction, `issues-round-${round}.json`),
            review.issues,
        );

        const blocking = review.issues.filter(isBlocking);
        log(`[critic-r${round}] ${review.issues.length} issues, ${blocking.length} blocking`);

        if (blocking.length === 0) {
            log(`[critic-r${round}] no blocking issues — stopping critic loop`);
            break;
        }
        if (round >= maxRounds) {
            log(`[critic-r${round}] max rounds reached, ${blocking.length} blocking issues remain`);
            break;
        }

        const rev = await runRole(`reviser-r${round}`, 'Claude',
            () => reviserRole({ spec: vision, files, issues: review.issues }));
        files = mergeFiles(files, rev.files);
        await writeProjectFiles(root, rev.files, log);
        log(`[reviser-r${round}] revised ${rev.files.length} files`);
    }

    const changesManifest = {
        projectRoot: root,
        mode: scan.hasCode ? 'modify-in-place' : 'greenfield',
        existingFilesScanned: scan.files.length,
        created: files.filter((f) => f.mode === 'create').map((f) => f.path).sort(),
        modified: files.filter((f) => f.mode === 'modify').map((f) => f.path).sort(),
    };
    await writeJson(path.join(dirs.construction, 'changes.json'), changesManifest);
    log('[phase] 3/4 construction complete');

    // ==================== Phase 4: Transition ====================
    log('[phase] 4/4 transition');
    const acc = await runRole('acceptance-writer', 'OpenAI/codex',
        () => acceptanceWriterRole({
            vision,
            requirements: reqs.requirements,
            fileTree: arch.fileTree,
            files,
        }));
    await writeFile(path.join(dirs.transition, 'acceptance.md'), acc.acceptance);

    const dep = await runRole('deployment-writer', 'Claude',
        () => deploymentWriterRole({
            architecture: arch.architecture,
            fileTree: arch.fileTree,
            files,
        }));
    await writeFile(path.join(dirs.transition, 'deploy.md'), dep.deploy);
    log('[phase] 4/4 transition complete');

    // ==================== Top-level README ====================
    const finishedAt = new Date();
    const elapsedSec = ((finishedAt - startedAt) / 1000).toFixed(1);
    const cumulativeUsd = setup.getCumulativeUsd();
    const remainingBlocking = lastIssues.filter(isBlocking).length;
    const readme = renderRupReadme({
        slug,
        requirement: requirementText,
        startedAt,
        finishedAt,
        elapsedSec,
        cumulativeUsd,
        verdict: designReview.verdict,
        fileCount: files.length,
        createdCount: changesManifest.created.length,
        modifiedCount: changesManifest.modified.length,
        mode: changesManifest.mode,
        projectRoot: root,
        roundsRun: usageLog.filter((u) => u.role.startsWith('critic-r')).length,
        remainingBlocking,
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
        mode: changesManifest.mode,
        fileCount: files.length,
        created: changesManifest.created,
        modified: changesManifest.modified,
        remainingBlockingIssues: remainingBlocking,
        roles: usageLog,
    });

    log(`[done] rup mode — $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s — design: ${baseDir}, code: ${root}`);

    return {
        baseDir,
        projectRoot: root,
        files,
        created: changesManifest.created,
        modified: changesManifest.modified,
        mode: changesManifest.mode,
        verdict: designReview.verdict,
        issues: lastIssues,
        pipelineMode: 'rup',
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderRupReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, verdict, fileCount, createdCount, modifiedCount, mode, projectRoot, roundsRun, remainingBlocking }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — **RUP mode** (multi-agent pipeline, OpenAI + Claude).
> The design dossier lives in this folder. The actual code was written / modified
> directly under the project root: \`${projectRoot}\`. Review it with \`git diff\`.

## Original requirement

\`\`\`
${reqExcerpt}
\`\`\`

## Pipeline summary

| Field | Value |
| --- | --- |
| Pipeline mode | **rup** (full 4-phase, 11 roles) |
| Started | ${startedAt.toISOString()} |
| Finished | ${finishedAt.toISOString()} |
| Elapsed | ${elapsedSec}s |
| Total cost | \$${cumulativeUsd.toFixed(4)} |
| Mode | **${mode}** |
| Files touched | ${fileCount} (${createdCount} created, ${modifiedCount} modified) |
| Critic rounds | ${roundsRun} |
| Remaining blocking issues | ${remainingBlocking} |
| Design verdict | **${verdict}** |

## Outputs (design dossier)

### Phase 1 — Inception
- [vision.md](inception/vision.md) — purpose, stakeholders, success criteria, scope, use cases
- [vision-review-notes.md](inception/vision-review-notes.md) — what the reviewer changed and why

### Phase 2 — Elaboration
- [requirements.json](elaboration/requirements.json) — structured, prioritized requirements
- [architecture.md](elaboration/architecture.md) — components, tech choices, data flow
- [file_tree.json](elaboration/file_tree.json) — every file the architect proposed (with mode: create / modify and change_notes)
- [risks.md](elaboration/risks.md) — risk register with mitigations
- [design-review.md](elaboration/design-review.md) — Elaboration sign-off + verdict
- [design-findings.json](elaboration/design-findings.json) — specific gaps to fix

### Phase 3 — Construction (writes / edits at the project root, not under here)
- [changes.json](construction/changes.json) — manifest of created vs. modified files at the project root
- \`issues-round-N.json\` — critic findings per round

### Phase 4 — Transition
- [acceptance.md](transition/acceptance.md) — test scenarios + manual checklist
- [deploy.md](transition/deploy.md) — local + production deployment + ops

## Next steps

1. \`git status\` / \`git diff\` at the project root — review every file the construction phase touched.
2. Read [inception/vision.md](inception/vision.md) to confirm the agents understood the spec.
3. Sanity-check [elaboration/architecture.md](elaboration/architecture.md) against the diff.
4. Run the acceptance checklist in [transition/acceptance.md](transition/acceptance.md).

## Pipeline metadata

See [pipeline.json](pipeline.json) for full per-role token usage, cost, and the same created/modified manifest.
`;
}
