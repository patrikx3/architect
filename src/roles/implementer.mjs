import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(['create', 'modify']),
    })),
});

const SYSTEM = `You are a senior software engineer. You receive:

- The original spec
- A list of structured requirements
- An architecture description
- A file_tree of files to TOUCH, each with mode "create" or "modify" and change_notes
- For every "modify" entry: the FULL current content of that file at the project root

You produce: the full final content of every file in the tree.

Rules:
- Implement EVERY entry in the tree (both "create" and "modify"). Do not skip any.
- For "create" entries: write a complete, runnable file from scratch.
- For "modify" entries: start from the provided current content and apply ONLY the changes
  described in change_notes plus whatever else the architecture requires for this feature.
  Preserve everything unrelated — imports, helpers, formatting, comments, license headers.
  Do NOT rewrite the file in your own style.
- Each returned file's content is the COMPLETE new file (not a patch / diff / partial).
- Match the existing project's language, framework, indentation, quoting style, and
  conventions. Read the surrounding code before deciding how to write yours.
- Do not invent dependencies — only use what the architect specified or what is obvious
  from the spec / existing imports.
- Do not add files outside the tree. Do not delete files (omit them and they stay as-is).
- Echo back the same path + mode the architect listed.`;

function formatTree(fileTree, existingByPath) {
    return fileTree.map((entry) => {
        const lines = [`## ${entry.path}  (mode: ${entry.mode})`];
        lines.push(`Purpose: ${entry.purpose}`);
        if (entry.depends_on?.length) lines.push(`Depends on: ${entry.depends_on.join(', ')}`);
        if (entry.change_notes) lines.push(`Notes: ${entry.change_notes}`);
        if (entry.mode === 'modify') {
            const current = existingByPath.get(entry.path);
            if (current != null) {
                lines.push('', 'Current content:', '```', current, '```');
            } else {
                lines.push('', '_(architect listed mode=modify but no current content was provided — treat as create)_');
            }
        }
        return lines.join('\n');
    }).join('\n\n');
}

export default async function implementerRole({ spec, requirements, architecture, fileTree, existingFiles = [] }) {
    const existingByPath = new Map(existingFiles.map((f) => [f.path, f.content]));
    const user = `# Spec

${spec}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Architecture

${architecture}

# File tree to implement

${formatTree(fileTree, existingByPath)}

Produce the full final content for every file. Return all files in one tool call. Echo each file's mode (create / modify) so downstream tooling knows which were modifications.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'implementer_output',
        maxTokens: 32_000,
    });
    return { files: result.data.files, usage: result.usage };
}
