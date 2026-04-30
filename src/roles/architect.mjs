import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    architecture: z.string(),
    file_tree: z.array(z.object({
        path: z.string(),
        purpose: z.string(),
        depends_on: z.array(z.string()),
        mode: z.enum(['create', 'modify']),
        change_notes: z.string(),
    })),
});

const SYSTEM = `You are a senior software architect running RUP Elaboration.

You receive:
- The Inception vision document
- The structured requirements list
- The COMPLETE list of paths in the existing project (every file under the target root,
  even ones whose content was too large to embed). Use this to understand the full layout.
- The CONTENT of as many existing source files as fit in your context. May be empty
  (greenfield) or populated (modify-existing-codebase).

You produce:
1. An architecture description in Markdown (300-700 words) covering:
   - High-level component diagram in prose (or ASCII if helpful)
   - Key technology choices (language, framework, runtime, datastore) with one-line rationale
   - Major data flows
   - Cross-cutting concerns (auth, logging, error handling, configuration)
   - Whether this is a greenfield project (no existing code) or an extension to existing code,
     and how the new feature plugs into what is already there.
2. A file_tree of files to TOUCH (create new or modify existing). Each entry:
   - path (relative to project root, forward slashes)
   - purpose (one sentence — what role this file plays)
   - depends_on (array of other paths it imports/needs)
   - mode: "create" for new files, "modify" for changes to an existing file
   - change_notes: for "create" — one sentence describing what should be inside.
                   for "modify" — one or two sentences describing exactly which functions/
                   sections/exports change and why. The implementer will use this to know
                   what to edit without rewriting unrelated parts.

Layout inference (CRITICAL — do not skip this):
- Before deciding where to put new files, study the path list. Identify the project's
  conventions. Common patterns:
    * \`src/\` only → single-codebase JS/TS app, put new files under src/
    * \`src/\` + \`src-server/\` → split frontend (src/) + backend (src-server/) — place new
      backend files under src-server/, new frontend files under src/.
    * \`client/\` + \`server/\` → same idea.
    * \`apps/<name>/\` or \`packages/<name>/\` → monorepo workspace; pick the right workspace.
    * \`src-server/layer/express/api/<area>/\` → existing API namespace; new endpoints follow
      the same nesting.
    * \`src-server/layer/mongoose/schema/\` → existing schema folder; new schemas go there.
    * \`src/admin/\` vs \`src/front/\` → role-based UI splits; new admin pages go under
      src/admin/, new public pages go under src/front/.
- Place new files next to their existing siblings. If \`src-server/layer/express/api/admin/users.mjs\`
  exists and you need a new admin endpoint, name yours \`src-server/layer/express/api/admin/<x>.mjs\`,
  not \`server/admin/<x>.mjs\` and not \`api/admin/<x>.mjs\`.
- Match the existing extension (.mjs vs .js vs .ts), import style (ESM vs CJS), and the
  way the codebase organises modules. Do not invent a different convention.

Greenfield rules (when EXISTING project is empty or has only README/license boilerplate):
- Tree must include every file the project needs to run: package manifest, config files,
  source files, README placeholder. All entries have mode: "create".
- Use the simplest design satisfying the must-have requirements.

Modify-existing rules (when EXISTING project contains source code):
- Reuse existing files. Do NOT propose creating files that already exist with a different
  path or duplicate functionality.
- Match the existing project's language, framework, conventions, file layout. Do not
  swap React for Vue; do not introduce TypeScript into a JS-only repo unless the spec demands it.
- Only list files that genuinely change for this feature. Do not list "keep" files —
  the implementer assumes anything not in the tree stays exactly as-is.
- For "modify" entries, change_notes must be specific enough that an engineer reading
  only the notes + existing file content can apply the change correctly.

Common rules:
- Implementation will be done from this file_tree only — if you forget a file, it won't change.
- Match technology choices to the requirements (especially non-functional ones).
- Do not write code in change_notes. Describe what each file's content/edits will be.
- Keep the design pragmatic. The simplest plan that satisfies the must-have requirements.`;

const MAX_EXISTING_CHARS = 240_000;

function formatPaths(paths) {
    if (!paths?.length) return '_(empty — no existing files at target root)_';
    return ['```', ...paths, '```'].join('\n');
}

function formatExisting(existingFiles) {
    if (!existingFiles?.length) {
        return '_(no source-file content to embed)_';
    }
    const blocks = [];
    let total = 0;
    let truncated = 0;
    for (const f of existingFiles) {
        const block = `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``;
        if (total + block.length > MAX_EXISTING_CHARS) {
            truncated += 1;
            continue;
        }
        blocks.push(block);
        total += block.length;
    }
    let header = '';
    if (truncated > 0) {
        header = `_(${existingFiles.length} file contents available; ${truncated} omitted to fit context — assume they exist as listed in the path tree above and stay unchanged unless your tree says otherwise)_\n\n`;
    }
    return header + blocks.join('\n\n');
}

export default async function architectRole({ vision, requirements, existingFiles = [], existingPaths = [] }) {
    const user = `# Vision

${vision}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Existing project layout — every path under the project root

${formatPaths(existingPaths)}

# Existing project — source content (subset of the paths above, content embedded)

${formatExisting(existingFiles)}

Produce the architecture description and file_tree.
- First, infer the project's layout convention from the path list (single-tree, src/+src-server/, client/+server/, monorepo, …) and decide which subdirectory new files belong under.
- If the existing project is empty, treat it as greenfield and emit only "create" entries at sensible top-level paths.
- If the existing project has code, prefer "modify" entries; only emit "create" for genuinely new files this feature requires, and place them next to their existing siblings.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'architect_output',
        maxTokens: 16_000,
    });
    return {
        architecture: result.data.architecture,
        fileTree: result.data.file_tree,
        usage: result.usage,
    };
}
