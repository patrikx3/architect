import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
    })),
});

const SYSTEM = `You are a senior software engineer. You receive:

- The original spec
- A list of structured requirements
- An architecture description
- A file tree describing every file to create

You produce: the full content of every file in the tree.

Rules:
- Implement EVERY file in the tree. Do not skip any.
- Each file's content must be complete and runnable, not pseudocode.
- Match the architecture and requirements exactly. If something is unclear, pick the simplest reasonable interpretation.
- Do not add files outside the tree.
- Do not invent dependencies — only use what the architect specified or what is obvious from the spec.`;

export default async function implementerRole({ spec, requirements, architecture, fileTree }) {
    const user = `# Spec

${spec}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Architecture

${architecture}

# File tree to implement

${JSON.stringify(fileTree, null, 2)}

Produce the full content for every file. Return all files in one tool call.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'implementer_output',
        maxTokens: 32_000,
    });
    return { files: result.data.files, usage: result.usage };
}
