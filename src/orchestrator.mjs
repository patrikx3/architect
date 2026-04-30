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
            return await runArchitect(opts, log);
        } finally {
            subLogFlush();
        }
    });
}

async function runArchitect({
    spec: specInput,
    specPath,
    requirement,
    slug,
    outputDir,
    projectRoot,
    maxRounds = 2,
    budgetUsd = 5,
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

    const dirs = {
        inception: path.join(baseDir, 'inception'),
        elaboration: path.join(baseDir, 'elaboration'),
        construction: path.join(baseDir, 'construction'),
        transition: path.join(baseDir, 'transition'),
    };
    for (const d of Object.values(dirs)) await ensureDir(d);
    // NOTE: no nested construction/project/ folder anymore. Code is written
    // directly to `root` — either creating a greenfield project or modifying an
    // existing one in place. agents/<slug>/construction/ keeps the design dossier
    // (issues-round-N.json, changes manifest) but never duplicates the source tree.

    // Scan the existing project so the architect/implementer/reviser can either
    // recognise an empty root (greenfield) or modify in place.
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

    // Wraps every role call so we get start, finish, elapsed-ms, and (via the
    // log-context AsyncLocalStorage) every line of sub-CLI output in between.
    // Effect: a typical pipeline emits ~50–100 log lines instead of ~22, so the
    // user always sees something fresh during a long run.
    const runRole = async (label, provider, fn) => {
        const t0 = Date.now();
        log(`[${label}] start (${provider})`);
        const result = await fn();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        log(`[${label}] done in ${elapsed}s`);
        checkBudget(label, result.usage);
        return result;
    };

    log(`[pipeline] start — slug=${slug ?? '(none)'}, output=${baseDir}`);

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

    // Persist a manifest of every file the construction phase touched, separating
    // creations from modifications. This is the user-facing "what changed" summary
    // — the actual code is in the project root, reviewable via `git diff`.
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
    const remainingBlocking = lastIssues.filter(isBlocking).length;
    const readme = renderReadme({
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

    log(`[done] $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s — design: ${baseDir}, code: ${root}`);

    return {
        baseDir,
        projectRoot: root,
        files,
        created: changesManifest.created,
        modified: changesManifest.modified,
        mode: changesManifest.mode,
        verdict: designReview.verdict,
        issues: lastIssues,
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, verdict, fileCount, createdCount, modifiedCount, mode, projectRoot, roundsRun, remainingBlocking }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — multi-agent RUP pipeline (OpenAI + Claude).
> The design dossier lives in this folder. The actual code was written / modified
> directly under the project root: \`${projectRoot}\`. Review it with \`git diff\`.

## Original requirement

\`\`\`
${reqExcerpt}
\`\`\`

## Pipeline summary

| Field | Value |
| --- | --- |
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
