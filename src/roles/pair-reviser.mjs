import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(['create', 'modify']),
    })),
});

const SYSTEM = `You are the reviser half of a 2-AI pair-programming workflow.

Your role: IMPLEMENTER, REFACTORING ASSISTANT, TEST WRITER, GITHUB/CODE WORKER. Codex
already wrote the code; Claude reviewed it and produced an issues list. You apply the
fixes. You do NOT rewrite the architecture — execute the fix_hints precisely.

You receive:
- The original plain-language requirement
- The plan Claude wrote earlier
- The current state of every file you wrote (path + content + mode)
- A list of issues from Claude reviewer (severity, file, issue, fix_hint)

You produce: the updated content of every file that needs changes.

Rules:
- Address every high-severity issue. Address medium issues unless doing so would conflict
  with the plan or requirement.
- You may ignore low-severity issues if they would add complexity.
- Return ONLY files that changed. Files that are still correct should NOT appear.
- Each returned file must contain the FULL new content, not a diff.
- Preserve each file's original mode ("create" stays "create", "modify" stays "modify").
- Do not introduce new files unless an issue explicitly requires it. New files use mode: "create".
- Do not regress on issues you already fixed in earlier rounds.
- For files originally marked "modify", continue to preserve unrelated existing logic. Do not
  let a review round become an excuse to rewrite the file.`;

export default async function pairReviserRole({ requirement, plan, files, issues }) {
    const fileBlock = files
        .map((f) => `## ${f.path}  (mode: ${f.mode ?? 'create'})\n\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

    const user = `# Original requirement

${requirement}

# Plan (Claude planner)

${plan}

# Current files

${fileBlock}

# Issues to address (from Claude reviewer)

${JSON.stringify(issues, null, 2)}

Apply the fixes. Return only the files that changed, with full new content and the same mode they had before.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'pair_reviser_output',
    });
    return { files: result.data.files, usage: result.usage };
}
