import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    issues: z.array(z.object({
        severity: z.enum(['high', 'medium', 'low']),
        file: z.string(),
        issue: z.string(),
        fix_hint: z.string(),
    })),
});

const SYSTEM = `You are a senior code reviewer. You receive:

- The original spec
- The structured requirements
- The architecture description
- Every file the implementer touched (path + content + mode "create" or "modify")

You produce a list of concrete, actionable issues. Severity scale:

- high: spec violation, broken code, missing required file, security flaw, runtime error
- medium: incorrect behavior on edge cases, weak error handling, mismatched architecture
- low: style, naming, minor improvements

Rules:
- Be specific. Cite the exact file in 'file' and describe what is wrong in 'issue'.
- 'fix_hint' tells the next role how to fix it — short, prescriptive.
- For files marked "modify", be especially careful: flag any unrelated lines / functions
  that look removed or rewritten without justification (regressions are high severity).
- If the implementation looks correct and complete, return an empty issues array.
- Do not invent issues to look thorough. Empty is a valid answer.
- Do not list cosmetic preferences as high or medium.`;

export default async function criticRole({ spec, requirements, architecture, files }) {
    const fileBlock = files
        .map((f) => `## ${f.path}  (mode: ${f.mode ?? 'create'})\n\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

    const user = `# Spec

${spec}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Architecture

${architecture}

# Files produced

${fileBlock}

Review the files. Return all issues in one response. Empty array if none.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'critic_output',
    });
    return { issues: result.data.issues, usage: result.usage };
}
