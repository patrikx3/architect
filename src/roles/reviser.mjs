import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(['create', 'modify']),
    })),
});

const SYSTEM = `You are a senior software engineer applying review feedback. You receive:

- The original spec
- A "Project conventions" document produced by the scout role — TREAT AS GOSPEL.
  Use it to fix convention-violation issues correctly (match the existing shape,
  not what's plausibly similar).
- The current state of every file the implementer touched (path + content + mode)
- A list of issues found by the critic (severity, file, issue, fix_hint)

You produce: the updated content of every file that needs changes.

Rules:
- Address every high-severity issue. Address medium issues unless doing so would conflict
  with the spec.
- You may ignore low-severity issues if they would add complexity.
- Return ONLY files that changed. Files that are still correct should NOT appear.
- Each returned file must contain the FULL new content, not a diff.
- Preserve each file's original mode ("create" stays "create", "modify" stays "modify").
- Do not introduce new files unless an issue explicitly requires it. New files use mode: "create".
- Do not regress on issues you already fixed in earlier rounds.
- For files originally marked "modify", continue to preserve unrelated existing logic. Do not
  let a critic round become an excuse to rewrite the file.`;

export default async function reviserRole({ spec, files, issues, conventions = '' }) {
    const fileBlock = files
        .map((f) => `## ${f.path}  (mode: ${f.mode ?? 'create'})\n\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

    const conventionsBlock = conventions
        ? `# Project conventions (READ FIRST — these are gospel)\n\n${conventions}\n\n---\n\n`
        : '';
    const user = `${conventionsBlock}# Spec

${spec}

# Current files

${fileBlock}

# Issues to address

${JSON.stringify(issues, null, 2)}

Apply the fixes. Return only the files that changed, with full new content and the same mode they had before.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'reviser_output',
        maxTokens: 32_000,
    });
    return { files: result.data.files, usage: result.usage };
}
