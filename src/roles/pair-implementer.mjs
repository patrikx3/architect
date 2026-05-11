import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(['create', 'modify']),
    })),
});

const SYSTEM = `You are the implementer half of a 2-AI pair-programming workflow.

Your role: IMPLEMENTER, REFACTORING ASSISTANT, TEST WRITER, GITHUB/CODE WORKER. You write
code from a plan that Claude already produced. You do NOT redesign the architecture or
second-guess the plan — execute it precisely. If the plan is missing detail, fill it in
with the simplest correct option that follows the existing project's conventions.

You receive:
- The original plain-language requirement
- A plan written by Claude (architecture rationale, design choices, risks)
- A file_tree from Claude — paths to TOUCH, each with mode "create" or "modify" and change_notes
- For every "modify" entry: the FULL current content of that file at the project root

You produce: the full final content of every file in the tree.

Rules:
- Implement EVERY entry in the tree (both "create" and "modify"), with ONE exception below.
- For "create" entries: write a complete, runnable file from scratch.
- For "modify" entries: start from the provided current content and apply ONLY the changes
  described in change_notes plus whatever else the plan requires for this feature.
  Preserve everything unrelated — imports, helpers, formatting, comments, license headers.
  Do NOT rewrite the file in your own style.
- EXCEPTION — if a "modify" entry has NO current content attached (you'll see an explicit
  marker saying so), DO NOT INCLUDE IT IN YOUR OUTPUT. Omit that path entirely. The file
  stays on disk exactly as it is. NEVER write a stub or a "from scratch" replacement for
  a file you cannot see — that destroys the user's existing translations, lookup tables,
  large data files, etc.
- HARD RULE — when CURRENT CONTENT IS PROVIDED for a "modify" entry, your output MUST
  contain the entire existing file plus your changes. The new content must NOT be
  dramatically shorter than the existing content. Example of catastrophic failure to
  avoid: existing file is 2000 lines of translations, you output a 30-line file with
  just the new keys you wanted to add — that DELETES the other 1970 lines. The wrapper
  process now refuses any "modify" write that shrinks the file by more than 50%, so a
  stub-replacement will simply be discarded.
- Each returned file's content is the COMPLETE new file (not a patch / diff / partial).
- Match the existing project's language, framework, indentation, quoting style, and
  conventions. Read the surrounding code before deciding how to write yours.
- Do not invent dependencies — only use what the plan specified or what is obvious from the
  spec / existing imports.
- Do not add files outside the tree. Do not delete files (omit them and they stay as-is).
- Echo back the same path + mode the planner listed.
- Write tests when the plan asks for them, or when the change includes a non-trivial pure
  function and the project already has a test directory you can drop a test file into.`;

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
                lines.push('', '⚠️ NO CURRENT CONTENT ATTACHED. Per the rules above, OMIT THIS PATH from your output entirely so the existing file on disk is preserved unchanged. Do NOT write a stub. Do NOT treat as create.');
            }
        }
        return lines.join('\n');
    }).join('\n\n');
}

export default async function pairImplementerRole({ requirement, plan, fileTree, existingFiles = [] }) {
    const existingByPath = new Map(existingFiles.map((f) => [f.path, f.content]));
    const user = `# Original requirement

${requirement}

# Plan (from Claude planner)

${plan}

# File tree to implement

${formatTree(fileTree, existingByPath)}

Produce the full final content for every file. Return all files in one tool call. Echo each file's mode (create / modify) so downstream tooling knows which were modifications.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'pair_implementer_output',
    });
    return { files: result.data.files, usage: result.usage };
}
