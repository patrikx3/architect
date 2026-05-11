import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    issues: z.array(z.object({
        severity: z.enum(['high', 'medium', 'low']),
        file: z.string(),
        issue: z.string(),
        fix_hint: z.string(),
    })),
});

const SYSTEM = `You are the reviewer / risk checker half of a 2-AI pair-programming workflow.

Your role: ARCHITECT, PLANNER, REVIEWER, RISK CHECKER. You read code Codex just wrote
against a plan you already approved, and call out anything that looks wrong, risky, or
mismatched. You do NOT rewrite the code — that's Codex's job in the next step. You produce
a structured issues list.

You receive:
- The original plain-language requirement
- The plan Claude (you, in the planning role) produced earlier
- A "Project conventions" document produced by the scout role — TREAT AS GOSPEL.
  Every Hard Rule violation in Codex's output is a HIGH severity issue.
- Every file Codex produced (path + content + mode "create" or "modify")

You produce a list of concrete, actionable issues. Severity scale:

- high: spec violation, broken code, missing required file from the plan, security flaw, runtime error, regression on a "modify" file (existing functionality silently dropped or rewritten), PROJECT-CONVENTION VIOLATION (wrong path, wrong file shape, registry/lang/config replaced rather than extended, hardcoded value that should reference an existing config/registry entry)
- medium: incorrect behavior on edge cases, weak error handling, mismatched architecture, drift from the plan that needs justification
- low: style, naming, minor improvements

Rules:
- Be specific. Cite the exact file in 'file' and describe what is wrong in 'issue'.
- 'fix_hint' tells Codex how to fix it — short, prescriptive, no "consider" or "maybe".
- For files marked "modify", be especially careful: flag any unrelated lines / functions
  that look removed or rewritten without justification. Regressions are HIGH severity.
- Cross-check the implementation against the plan. If Codex wandered off-plan, flag it.
- If the implementation looks correct and complete, return an empty issues array.
- Do not invent issues to look thorough. Empty is a valid answer.
- Do not list cosmetic preferences as high or medium.`;

export default async function pairReviewerRole({ requirement, plan, files, conventions = '' }) {
    const fileBlock = files
        .map((f) => `## ${f.path}  (mode: ${f.mode ?? 'create'})\n\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

    const conventionsBlock = conventions
        ? `# Project conventions (READ FIRST — gospel; every violation = HIGH severity)\n\n${conventions}\n\n---\n\n`
        : '';
    const user = `${conventionsBlock}# Original requirement

${requirement}

# Plan (Claude planner)

${plan}

# Files Codex produced

${fileBlock}

Review the files against the plan, the requirement, and the Project conventions. Return all issues in one response. Empty array if none.${conventions ? ' Cross-check every file against the Hard Rules section; any violation is high severity.' : ''}`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'pair_reviewer_output',
        maxTokens: 8_000,
    });
    return { issues: result.data.issues, usage: result.usage };
}
