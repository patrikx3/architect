import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    plan: z.string(),
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        mode: z.enum(['create', 'modify']),
        change_notes: z.string(),
    })),
});

const SYSTEM = `You are a senior full-stack engineer working in fast pair-programming mode.
You combine architect + implementer in a single pass: read the project, design the change,
and write every file in one response. A second AI (codex) will critique your output afterwards
— so be precise, but don't over-spec a separate design phase.

You receive:
- A plain-language requirement
- The COMPLETE list of paths in the existing project (every file under the target root,
  even ones whose content was too large to embed)
- The CONTENT of as many existing source files as fit in your context. May be empty
  (greenfield) or populated (modify-existing-codebase)

You produce:
1. plan: a short Markdown rationale (3-8 sentences). Cover: greenfield vs modify-in-place,
   key tech choices (only if greenfield), which subdirectory new files go under, what each
   modification does. Do NOT write code in the plan — keep it design-level.
2. files: COMPLETE final content of every file you create or modify. Each entry has:
   - path (relative, forward slashes)
   - content (the full new file)
   - mode: "create" for new files, "modify" for changes to existing files
   - change_notes: one short sentence of what this file does / changes (used by the critic)

Layout inference (CRITICAL — do not skip):
- Study the path list before deciding where to put new files. Common patterns:
  * \`src/\` only → single-codebase JS/TS, new files under src/
  * \`src/\` + \`src-server/\` → split frontend/backend, place backend under src-server/
  * \`client/\` + \`server/\` → same idea
  * \`apps/<name>/\`, \`packages/<name>/\` → monorepo workspace
  * \`src-server/layer/express/api/<area>/\` → existing API namespace; new endpoints follow the same nesting
  * \`src-server/layer/mongoose/schema/\` → existing schema folder; new schemas go there
  * \`src/admin/\` vs \`src/front/\` → role-based UI splits
- Place new files NEXT TO their existing siblings. Match existing extension (.mjs / .js / .ts),
  import style (ESM vs CJS), naming, formatting.

Modify-in-place rules (when the project already has source code):
- Reuse existing files. Do NOT propose creating files that duplicate existing ones at a different path.
- For "modify" entries: start from the embedded current content and apply ONLY the changes
  the requirement needs. Preserve everything unrelated — imports, helpers, formatting,
  comments, license headers. Do NOT rewrite the file in your own style.
- Each "modify" file's content is the COMPLETE new file (not a diff). The implementer is YOU.
- Match the existing project's language, framework, indentation, quoting style, conventions.
- Do not invent dependencies — use what's obvious from the existing imports.
- Don't list files that don't actually change. Anything not in your files list stays as-is.

Greenfield rules (when EXISTING project is empty or has only README/license boilerplate):
- Files list must include every file the project needs to run: package manifest, config, source,
  README placeholder. All entries have mode: "create".
- Use the simplest design satisfying the requirement.

Common rules:
- Implement EVERY file in one response. Don't return placeholders or "see plan".
- Don't add files outside what the requirement needs. Don't delete files (omit them and they stay).
- Don't write code in the plan. Code goes in files[].content.`;

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
        header = `_(${existingFiles.length} file contents available; ${truncated} omitted to fit context — assume they exist as listed in the path tree above and stay unchanged unless your files list says otherwise)_\n\n`;
    }
    return header + blocks.join('\n\n');
}

export default async function pairImplementerRole({ requirement, existingFiles = [], existingPaths = [] }) {
    const user = `# Requirement

${requirement}

# Existing project layout — every path under the project root

${formatPaths(existingPaths)}

# Existing project — source content (subset of the paths above, content embedded)

${formatExisting(existingFiles)}

Produce the plan and the full final content of every file you create or modify.
- Infer the project's layout convention from the path list (single-tree, src/+src-server/, client/+server/, monorepo, …) before deciding where new files go.
- If the existing project is empty, treat it as greenfield and emit only "create" entries at sensible top-level paths.
- If the existing project has code, prefer "modify" entries; only emit "create" for genuinely new files this requirement needs, placed next to their existing siblings.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'pair_implementer_output',
        maxTokens: 32_000,
    });
    return {
        plan: result.data.plan,
        files: result.data.files,
        usage: result.usage,
    };
}
