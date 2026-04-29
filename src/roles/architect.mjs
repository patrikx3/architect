import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    architecture: z.string(),
    file_tree: z.array(z.object({
        path: z.string(),
        purpose: z.string(),
        depends_on: z.array(z.string()),
    })),
});

const SYSTEM = `You are a senior software architect running RUP Elaboration.

You receive:
- The Inception vision document
- The structured requirements list

You produce:
1. An architecture description in Markdown (400-900 words) covering:
   - High-level component diagram in prose (or ASCII if helpful)
   - Key technology choices (language, framework, runtime, datastore) with one-line rationale
   - Major data flows
   - Cross-cutting concerns (auth, logging, error handling, configuration)
2. A complete file tree (every file the project will need). Each node has:
   - path (relative)
   - purpose (one sentence)
   - depends_on (array of other file paths it imports/needs)

Rules:
- Implementation will be done from this file_tree only — if you forget a file, it won't exist.
- Include configuration files (package.json, tsconfig, README placeholder, dotfiles when needed).
- Match the technology choices to the requirements (especially non-functional ones).
- Do not write code. Describe each file's purpose.
- Keep the architecture pragmatic. The simplest design that satisfies the must-have requirements.`;

export default async function architectRole({ vision, requirements }) {
    const user = `# Vision

${vision}

# Requirements

${JSON.stringify(requirements, null, 2)}

Produce the architecture description and file_tree.`;

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
