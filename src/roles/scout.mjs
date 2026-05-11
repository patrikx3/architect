import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

// Scout role — RUNS FIRST on any existing-codebase modification.
//
// Purpose: produce a shared "conventions" document so every downstream role
// (architect, implementer, critic, reviser, pair-*) writes code that matches
// the existing project's specific patterns rather than generic boilerplate.
//
// Scout is fully stack-agnostic. The system prompt contains zero example
// category names, zero stack-specific keywords, zero assumed file extensions.
// It just tells the scout to OBSERVE the files in front of it and describe
// the patterns it sees in whatever structure fits this particular project.

const Schema = z.object({
    conventions: z.string(),
    detected_categories: z.array(z.string()),
});

const SYSTEM = `You are a senior engineer doing a SCOUT pass on an existing
codebase before any other AI touches it. Your output becomes a shared
"conventions" document that every downstream role (architect, implementer,
critic, reviser, pair-planner, pair-implementer, pair-reviewer, pair-reviser)
reads and treats as gospel.

Your goal: extract THIS SPECIFIC project's conventions — whatever patterns it
actually uses — so the implementer writes code that LOOKS AND BEHAVES like the
rest of THIS codebase rather than generic boilerplate.

You are fully stack-agnostic. Make NO assumptions about the language, framework,
folder layout, file extensions, or naming conventions. Discover them from the
files you are given. Do not try to pattern-match the codebase against any
specific stack you have seen before — describe only what is in front of you.

# What you receive

- The original requirement / feature description (so you know which conventions
  matter most for this feature).
- The COMPLETE list of paths in the project.
- The CONTENT of representative files chosen by a smart-picker that clusters
  files by name suffix, by parent directory, by extension, and by role-suffix
  heuristics, then picks exemplars from each cluster. Treat the files you
  receive as representative of the codebase's vocabulary.

# What you produce

A Markdown document describing the conventions of this codebase. There is no
required section structure — use whatever makes sense for THIS project. The
sections should reflect the patterns you actually see, named with the same
vocabulary the project itself uses (so if files are organized in folders like
\`application/controllers/\`, your section is "application/controllers"; if they
are named \`*.queue.mjs\`, your section is "*.queue.mjs files"; if neither, use
whatever pattern label fits).

For each pattern you describe, include:

1. **Where files in this pattern live** — exact path or glob.
2. **Naming convention** — the rule (suffix, prefix, casing, whatever the
   project uses).
3. **File shape** — narrative description of what's at the top of the file
   (imports), what's exported, how the file registers itself with the rest of
   the system (if at all), and any structural conventions inside the body.
4. **Example** — quote a real 10-25 line snippet from one of the files you
   were given. Include the source path of the snippet.
5. **What the implementer must replicate** — non-obvious bits an outsider
   would miss (registration mechanism, naming nuance, etc.).
6. **What the implementer must NOT do** — specific failure modes you can
   infer from the example (wrong path, wrong shape, hardcoded values that
   should be referenced from a config, replacing a file instead of extending
   it, etc.).

Also describe:

- **Central wiring or dependency-injection mechanism**, if one exists.
  Whatever file or pattern the project uses to wire shared utilities together —
  the implementer MUST NOT replace such files; only extend them.
- **Config / settings access pattern**, if one exists. The implementer MUST
  reference values via the established pattern; NEVER hardcode.
- **Large data files** that look like dictionaries / fixtures / translations /
  seed data. The implementer MUST extend such files (add one entry), never
  replace them.
- **Build and tooling**: package manager (inferred from lock files), build
  script, test runner. Short notes only.

After all the pattern sections, end with:

## Hard rules for downstream roles

A bulleted list of the absolute non-negotiables you derived from the patterns
above. Each rule must be SPECIFIC to this project (cite exact paths, exact
file shapes, exact access patterns). Generic rules like "follow conventions"
are useless. The hard rules section is the most important — it gets quoted
back in every downstream role's prompt and is what the critic / reviewer use
as the standard.

# Rules for YOUR output

- Be concrete and code-quoted. Generic descriptions are useless; specific
  quotes from the files you saw are gold.
- Every pattern section MUST include a real code snippet quoted from a file
  the smart-picker showed you, with the source path identified.
- If you don't have evidence for a pattern, OMIT IT. Do not fabricate.
- Adapt the section names and structure to the project's vocabulary. Don't
  force this project into a structure that doesn't fit it.
- 600-2000 words. Long enough to be authoritative, short enough that every
  downstream role will read it.
- Plain Markdown. No frontmatter. No code fences wrapping the whole document.

Also return a free-form list of the category names you actually covered, for
the orchestrator log.`;

const MAX_EXISTING_CHARS = 180_000;

function formatPaths(paths) {
    if (!paths?.length) return '_(empty)_';
    return ['```', ...paths, '```'].join('\n');
}

function formatExisting(existingFiles) {
    if (!existingFiles?.length) return '_(no source content)_';
    const blocks = [];
    let total = 0;
    let truncated = 0;
    for (const f of existingFiles) {
        const block = `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``;
        if (total + block.length > MAX_EXISTING_CHARS) { truncated += 1; continue; }
        blocks.push(block);
        total += block.length;
    }
    let header = '';
    if (truncated > 0) {
        header = `_(${existingFiles.length} files available; ${truncated} omitted to fit context)_\n\n`;
    }
    return header + blocks.join('\n\n');
}

export default async function scoutRole({ requirement, existingFiles = [], existingPaths = [] }) {
    const user = `# Feature being designed

${requirement}

# Project path list

${formatPaths(existingPaths)}

# Representative files (smart-picked exemplars)

${formatExisting(existingFiles)}

Produce the conventions document. Discover whatever patterns this project actually uses — don't assume anything. Include real code snippets quoted from the files above. End with a "Hard rules for downstream roles" section.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'scout_output',
    });
    return {
        conventions: result.data.conventions,
        detectedCategories: result.data.detected_categories,
        usage: result.usage,
    };
}
