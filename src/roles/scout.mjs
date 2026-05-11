import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

// Scout role — RUNS FIRST on any existing-codebase modification.
//
// Why this role exists:
//   The implementer (and architect, critic, reviser, …) can only write code that
//   matches a project's conventions if those conventions are visible in their
//   context. scan-project caps total context, so on large repos convention-
//   defining files may be missing — leading the implementer to write generic
//   boilerplate that doesn't match the actual project shape.
//
//   Scout addresses this by READING THE CODEBASE FIRST and producing a "Conventions"
//   document. Every downstream role (architect, implementer, critic, reviser,
//   pair-*) gets this document and is instructed to follow it as gospel.
//
// Scout is language- and stack-agnostic. It does NOT have a hardcoded list of
// categories. It discovers whatever patterns the codebase actually uses — could
// be Bull queues + Mongoose schemas in a Node.js/Mongo project, controllers +
// models in a CodeIgniter PHP project, services + repositories in a Spring Java
// project, etc. The output is a Markdown document describing whatever patterns
// the scout actually sees.

const Schema = z.object({
    conventions: z.string(),
    detected_categories: z.array(z.string()),
});

const SYSTEM = `You are a senior engineer doing a SCOUT pass on an existing codebase
before any other AI touches it. Your output becomes a shared "conventions"
document that every downstream role (architect, implementer, critic, reviser,
pair-planner, pair-implementer, pair-reviewer, pair-reviser) reads and treats as
gospel.

Your goal: extract this SPECIFIC project's conventions — whatever patterns it
actually uses — so the implementer writes code that LOOKS AND BEHAVES like the
rest of the codebase rather than generic boilerplate.

You are language- and stack-agnostic. The codebase could be Node.js, PHP,
Python, Java, Rust, Go, C#, anything. Adapt to what you see. Do NOT assume
specific categories must exist; discover the ones that DO exist by reading the
files in front of you.

You receive:
- The original requirement / feature description (so you know which conventions
  matter most for this feature)
- The COMPLETE list of paths in the project
- The CONTENT of representative files chosen by a smart-picker (which clusters
  files by name suffix, top-level folder, and content patterns, then picks
  exemplars of each cluster — so what you see is meant to cover the project's
  vocabulary)

You produce a Markdown document organized however makes sense for THIS project.
Some heuristics:

1. **Identify recurring file-name patterns** — e.g. \`*.queue.mjs\`, \`*.schema.mjs\`,
   \`*.router.mjs\`, \`*.controller.php\`, \`*.service.ts\`, \`*Model.cs\`. Each cluster
   probably represents a convention. For each cluster the smart-picker gave you
   an example: read it and describe the convention.
2. **Identify recurring folder patterns** — e.g. \`src/components/\`, \`app/Models/\`,
   \`server/api/\`, \`src-server/layer/\`. Folders carry meaning. Describe what each
   significant folder is for and what shape files inside it have.
3. **Identify central wiring files** — package manifests, \`registry.mjs\`,
   \`bootstrap.php\`, \`AppKernel.php\`, dependency-injection config, module
   indexes. The implementer MUST NOT replace these; they should be EXTENDED.
4. **Identify config files** — where filesystem paths, env, secrets, settings
   live. The implementer MUST reference values via the established access
   pattern, NEVER hardcode.
5. **Identify localization / template / static resource folders** — large data
   files (lang dictionaries, fixtures) that the implementer MUST extend, never
   replace.
6. **Identify the test layout** — where tests live, what runner is used, what
   the file-naming convention is (\`*.test.mjs\`, \`*Test.php\`, \`test_*.py\`).
7. **Identify the build / tooling layout** — package manager (yarn / npm /
   pnpm / pip / composer / cargo / maven), lock file, build script, lint config.

For EACH pattern you identify, produce a section like:

### <pattern name, e.g. "Bull queue files">

- **Where they live:** \`<exact path or path glob>\`
- **Naming convention:** \`<naming rule, e.g. *.queue.mjs>\`
- **File shape:** narrative description of imports, exports, structure
- **Example (from <path of the example you read>):**
  \`\`\`<language>
  <10-25 lines of real code from the example, enough to make the pattern obvious>
  \`\`\`
- **What the implementer must replicate:** the non-obvious bits an outsider would miss
- **What the implementer must NOT do:** specific failure modes

After all the pattern sections, end with a "## Hard rules for downstream roles"
section that lists the absolute non-negotiables in bullet form. Examples (adjust
to the actual project):

- New schemas go in \`src-server/layer/mongoose/schema/\`; NEVER in any other folder.
- Queue files use the exact \`export default fn → { name, init }\` shape; NEVER a different shape.
- Registry file MUST be extended; NEVER replaced. Output of any "modify" on the
  registry must contain ALL existing imports + your additions.
- Lang / locale files MUST be extended; NEVER replaced. Add new keys as ONE
  line per locale.
- Config values MUST be referenced via the existing access pattern (e.g.
  \`registry.config.filesystem.transfer\`); NEVER hardcoded paths or magic strings.

Rules for YOUR output:
- Be concrete and code-quoted. Generic descriptions ("the project uses MVC") are
  useless. Specific code snippets ("this queue file looks like X, you must
  produce a file that looks like X") are gold.
- Each pattern section MUST include a real code snippet from a file the smart-
  picker showed you. Quote the path it came from.
- If you don't have an example for a pattern category, OMIT THE SECTION. Do not
  fabricate.
- 600-2000 words total. Long enough to be authoritative; short enough that every
  downstream role will read it.
- The "Hard rules" section is the most important — it is what every downstream
  role's system prompt will quote back to itself.
- Plain Markdown. No frontmatter. No code fences around the whole doc.

Also return a list of the category names you covered (so the orchestrator can
log them). E.g. ["Bull queues", "Mongoose schemas", "Express routers",
"Registry / DI", "Config", "Localization", "React components", "Tooling"].`;

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

Produce the conventions document. Discover whatever patterns this project actually uses — don't assume specific categories. Include real code snippets quoted from the files above. End with a "Hard rules" section.`;

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
