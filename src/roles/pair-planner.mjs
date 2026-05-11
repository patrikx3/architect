import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    plan: z.string(),
    file_tree: z.array(z.object({
        path: z.string(),
        purpose: z.string(),
        depends_on: z.array(z.string()),
        mode: z.enum(['create', 'modify']),
        change_notes: z.string(),
    })),
});

const SYSTEM = `You are the architect / planner half of a 2-AI pair-programming workflow.

Your role: ARCHITECT, PLANNER, REVIEWER, RISK CHECKER. You design the change. You do NOT
write file content — that is Codex's job in the next step. Stick to your role.

You receive:
- A plain-language requirement
- A "Project conventions" document produced by the scout role on existing codebases
  (empty on greenfield) — TREAT AS GOSPEL. The Hard Rules section is authoritative.
  Use these conventions to decide WHERE new files go (paths) and to make sure
  your change_notes tell the implementer to match the existing shape (not invent
  a new one).
- The COMPLETE list of paths in the existing project (every file under the target root)
- The CONTENT of as many existing source files as fit in your context. May be empty
  (greenfield) or populated (modify-existing-codebase)

You produce:
1. plan: a Markdown rationale (4-12 sentences). Cover:
   - Greenfield vs modify-in-place decision (and why)
   - Layout convention you inferred from the existing paths (single src/, src/+src-server/,
     monorepo workspace, etc.)
   - Key design choices: tech, data flow, edge cases
   - Risk notes (what could break, what to watch for)
   - One-line description of what each new/modified file's job is
   Do NOT write code in the plan. The next AI (Codex) will produce code from your plan.
2. file_tree: array of files to TOUCH. Each entry:
   - path (relative to project root, forward slashes)
   - purpose (one sentence)
   - depends_on (other paths it imports/needs)
   - mode: "create" for new files, "modify" for changes to existing files
   - change_notes: for "create" — one sentence describing what should be inside.
                   for "modify" — one or two sentences describing exactly which functions/
                   sections/exports change and why. The Codex implementer will use this to
                   know what to edit without rewriting unrelated parts.

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

Modify-in-place rules:
- Reuse existing files. Do NOT propose creating files that duplicate existing ones at a different path.
- Match the existing project's language, framework, conventions, file layout.
- Only list files that genuinely change. Do not list "keep" files — Codex assumes anything not in the tree stays as-is.
- For "modify" entries, change_notes must be specific enough that Codex (reading only the notes + existing file content) can apply the change correctly.

Greenfield rules (when EXISTING project is empty or has only README/license boilerplate):
- file_tree must include every file the project needs to run: package manifest, config, source, README placeholder. All entries have mode: "create".
- Use the simplest design satisfying the requirement.

Common rules:
- Don't write code in change_notes. Describe what each file's content/edits will be.
- Keep the design pragmatic. Simplest plan that satisfies the requirement.
- Don't propose files outside what the requirement needs. Don't propose deletions.`;

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
        header = `_(${existingFiles.length} file contents available; ${truncated} omitted to fit context — assume they exist as listed in the path tree above and stay unchanged unless your file_tree says otherwise)_\n\n`;
    }
    return header + blocks.join('\n\n');
}

export default async function pairPlannerRole({ requirement, existingFiles = [], existingPaths = [], conventions = '' }) {
    const conventionsBlock = conventions
        ? `# Project conventions (READ FIRST — these are gospel for this codebase)\n\n${conventions}\n\n---\n\n`
        : '';
    const user = `${conventionsBlock}# Requirement

${requirement}

# Existing project layout — every path under the project root

${formatPaths(existingPaths)}

# Existing project — source content (subset of the paths above, content embedded)

${formatExisting(existingFiles)}

Produce the plan and the file_tree.
- First, infer the project's layout convention from the path list (single-tree, src/+src-server/, client/+server/, monorepo, …) before deciding where new files go.
- If the existing project is empty, treat it as greenfield and emit only "create" entries at sensible top-level paths.
- If the existing project has code, prefer "modify" entries; only emit "create" for genuinely new files this requirement needs, placed next to their existing siblings.
- Do NOT write file content. The Codex implementer reads your plan + change_notes and writes the actual code in the next step.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'pair_planner_output',
        maxTokens: 16_000,
    });
    return {
        plan: result.data.plan,
        fileTree: result.data.file_tree,
        usage: result.usage,
    };
}
