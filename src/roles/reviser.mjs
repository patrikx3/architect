import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
    })),
});

const SYSTEM = `You are a senior software engineer applying review feedback. You receive:

- The original spec
- The current files (path + content)
- A list of issues found by the critic (severity, file, issue, fix_hint)

You produce: the updated content of every file that needs changes.

Rules:
- Address every high-severity issue. Address medium issues unless doing so would conflict with the spec.
- You may ignore low-severity issues if they would add complexity.
- Return ONLY files that changed. Files that are still correct should NOT appear in the output.
- Each returned file must contain the FULL new content, not a diff.
- Do not introduce new files unless an issue explicitly requires it.
- Do not regress on issues you already fixed in earlier rounds.`;

export default async function reviserRole({ spec, files, issues }) {
    const fileBlock = files
        .map((f) => `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

    const user = `# Spec

${spec}

# Current files

${fileBlock}

# Issues to address

${JSON.stringify(issues, null, 2)}

Apply the fixes. Return only the files that changed, with full new content.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'reviser_output',
        maxTokens: 32_000,
    });
    return { files: result.data.files, usage: result.usage };
}
