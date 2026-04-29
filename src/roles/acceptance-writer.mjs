import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    acceptance: z.string(),
});

const SYSTEM = `You are a senior QA engineer running RUP Transition.

You receive: the vision, the requirements, the file tree, and a sample of the produced
source files. You produce an 'acceptance.md' document.

Structure:
- # Acceptance Criteria
- ## Success bar (1-3 sentences — what 'done' means for this requirement set)
- ## Test scenarios (numbered list, each with: name, preconditions, steps, expected result,
  the requirement IDs it covers)
- ## Manual verification checklist (a checkable list a human runs before sign-off)
- ## Out-of-scope verification (briefly note what is NOT being tested and why)

Rules:
- Cover every must-have functional requirement with at least one scenario.
- Cover non-functional requirements where testable (e.g. response time, error response shape).
- Be concrete. "Send POST /tasks with body X, expect 201 + JSON {id,...}" not "test the API".
- 400-1000 words. Plain Markdown.`;

export default async function acceptanceWriterRole({ vision, requirements, fileTree, files }) {
    const fileSummary = files
        .slice(0, 30)
        .map((f) => `- ${f.path} (${f.content.length} chars)`)
        .join('\n');

    const user = `# Vision

${vision}

# Requirements

${JSON.stringify(requirements, null, 2)}

# File tree

${JSON.stringify(fileTree, null, 2)}

# Files produced (sample inventory)

${fileSummary}

Produce the acceptance document.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'acceptance_output',
    });
    return { acceptance: result.data.acceptance, usage: result.usage };
}
