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

const { ensureDir, writeFile, readFile, remove, pathExists } = fsExtra;

const isBlocking = (issue) => issue.severity === 'high' || issue.severity === 'medium';

const writeProjectFiles = async (projectDir, files) => {
    for (const file of files) {
        const target = path.join(projectDir, file.path);
        await ensureDir(path.dirname(target));
        await writeFile(target, file.content);
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

export async function architect({
    spec: specInput,
    specPath,
    requirement,
    slug,
    outputDir,
    projectRoot,
    maxRounds = 2,
    budgetUsd = 5,
    log = () => {},
}) {
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
    const projectDir = path.join(dirs.construction, 'project');
    await ensureDir(projectDir);

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

    // ==================== Phase 1: Inception ====================
    log('[inception] vision (OpenAI)…');
    const visionDraft = await visionRole({ requirement: requirementText });
    checkBudget('vision', visionDraft.usage);

    log('[inception] vision-reviewer (Claude)…');
    const visionFinal = await visionReviewerRole({
        requirement: requirementText,
        vision: visionDraft.vision,
    });
    checkBudget('vision-reviewer', visionFinal.usage);

    const vision = visionFinal.vision;
    await writeFile(path.join(dirs.inception, 'vision.md'), vision);
    await writeFile(path.join(dirs.inception, 'vision-review-notes.md'), visionFinal.notes);

    // ==================== Phase 2: Elaboration ====================
    log('[elaboration] requirements-analyst (OpenAI)…');
    const reqs = await requirementsAnalystRole({ vision });
    checkBudget('requirements-analyst', reqs.usage);
    await writeJson(path.join(dirs.elaboration, 'requirements.json'), reqs.requirements);

    log(`[elaboration] architect (Claude)…`);
    const arch = await architectRole({ vision, requirements: reqs.requirements });
    checkBudget('architect', arch.usage);
    await writeFile(path.join(dirs.elaboration, 'architecture.md'), arch.architecture);
    await writeJson(path.join(dirs.elaboration, 'file_tree.json'), arch.fileTree);

    log('[elaboration] risk-analyst (OpenAI)…');
    const risk = await riskAnalystRole({
        vision,
        requirements: reqs.requirements,
        architecture: arch.architecture,
    });
    checkBudget('risk-analyst', risk.usage);
    await writeFile(
        path.join(dirs.elaboration, 'risks.md'),
        `# Risks\n\n## Summary\n\n${risk.summary}\n\n## Risk register\n\n\`\`\`json\n${JSON.stringify(risk.risks, null, 2)}\n\`\`\`\n`,
    );

    log('[elaboration] design-reviewer (Claude)…');
    const designReview = await designReviewerRole({
        vision,
        requirements: reqs.requirements,
        architecture: arch.architecture,
        fileTree: arch.fileTree,
        risks: risk.risks,
    });
    checkBudget('design-reviewer', designReview.usage);
    await writeFile(path.join(dirs.elaboration, 'design-review.md'), designReview.review);
    await writeJson(path.join(dirs.elaboration, 'design-findings.json'), designReview.findings);
    log(`[elaboration] verdict: ${designReview.verdict}`);

    // ==================== Phase 3: Construction ====================
    log(`[construction] implementer (Claude, ${arch.fileTree.length} files)…`);
    const impl = await implementerRole({
        spec: vision,
        requirements: reqs.requirements,
        architecture: arch.architecture,
        fileTree: arch.fileTree,
    });
    checkBudget('implementer', impl.usage);
    let files = impl.files;
    await writeProjectFiles(projectDir, files);

    let lastIssues = [];
    for (let round = 1; round <= maxRounds; round += 1) {
        log(`[construction] critic round ${round} (OpenAI)…`);
        const review = await criticRole({
            spec: vision,
            requirements: reqs.requirements,
            architecture: arch.architecture,
            files,
        });
        checkBudget(`critic-r${round}`, review.usage);
        lastIssues = review.issues;
        await writeJson(
            path.join(dirs.construction, `issues-round-${round}.json`),
            review.issues,
        );

        const blocking = review.issues.filter(isBlocking);
        log(`[construction] round ${round}: ${review.issues.length} issues (${blocking.length} blocking)`);

        if (blocking.length === 0) break;
        if (round >= maxRounds) {
            log(`[construction] max rounds reached, ${blocking.length} blocking issues remain`);
            break;
        }

        log(`[construction] reviser round ${round} (Claude)…`);
        const rev = await reviserRole({ spec: vision, files, issues: review.issues });
        checkBudget(`reviser-r${round}`, rev.usage);
        files = mergeFiles(files, rev.files);
        await writeProjectFiles(projectDir, rev.files);
    }

    // ==================== Phase 4: Transition ====================
    log('[transition] acceptance-writer (OpenAI)…');
    const acc = await acceptanceWriterRole({
        vision,
        requirements: reqs.requirements,
        fileTree: arch.fileTree,
        files,
    });
    checkBudget('acceptance-writer', acc.usage);
    await writeFile(path.join(dirs.transition, 'acceptance.md'), acc.acceptance);

    log('[transition] deployment-writer (Claude)…');
    const dep = await deploymentWriterRole({
        architecture: arch.architecture,
        fileTree: arch.fileTree,
        files,
    });
    checkBudget('deployment-writer', dep.usage);
    await writeFile(path.join(dirs.transition, 'deploy.md'), dep.deploy);

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
        fileCount: files.length,
        remainingBlockingIssues: remainingBlocking,
        roles: usageLog,
    });

    log(`[done] $${cumulativeUsd.toFixed(4)} in ${elapsedSec}s — ${baseDir}`);

    return {
        baseDir,
        projectDir,
        files,
        verdict: designReview.verdict,
        issues: lastIssues,
        usage: { totalUsd: cumulativeUsd, perRole: usageLog },
    };
}

function renderReadme({ slug, requirement, startedAt, finishedAt, elapsedSec, cumulativeUsd, verdict, fileCount, roundsRun, remainingBlocking }) {
    const reqExcerpt = requirement.length > 400 ? `${requirement.slice(0, 400)}…` : requirement;
    return `# ${slug ?? 'architect output'}

> Generated by p3x-architect — multi-agent RUP pipeline (OpenAI + Claude).

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
| Files generated | ${fileCount} |
| Critic rounds | ${roundsRun} |
| Remaining blocking issues | ${remainingBlocking} |
| Design verdict | **${verdict}** |

## Outputs

### Phase 1 — Inception
- [vision.md](inception/vision.md) — purpose, stakeholders, success criteria, scope, use cases
- [vision-review-notes.md](inception/vision-review-notes.md) — what the reviewer changed and why

### Phase 2 — Elaboration
- [requirements.json](elaboration/requirements.json) — structured, prioritized requirements
- [architecture.md](elaboration/architecture.md) — components, tech choices, data flow
- [file_tree.json](elaboration/file_tree.json) — every file the project needs
- [risks.md](elaboration/risks.md) — risk register with mitigations
- [design-review.md](elaboration/design-review.md) — Elaboration sign-off + verdict
- [design-findings.json](elaboration/design-findings.json) — specific gaps to fix

### Phase 3 — Construction
- [project/](construction/project/) — the actual generated source code
- \`issues-round-N.json\` — critic findings per round

### Phase 4 — Transition
- [acceptance.md](transition/acceptance.md) — test scenarios + manual checklist
- [deploy.md](transition/deploy.md) — local + production deployment + ops

## Next steps

1. Open this folder in your IDE and read \`inception/vision.md\` first.
2. Sanity-check \`elaboration/architecture.md\` matches what you actually want.
3. Browse \`construction/project/\` — the generated implementation. Use Claude Code on it to refine.
4. Run the acceptance checklist in \`transition/acceptance.md\` once the code is integrated.

## Pipeline metadata

See [pipeline.json](pipeline.json) for full per-role token usage and cost breakdown.
`;
}
