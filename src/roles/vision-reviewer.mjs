import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    revised_vision: z.string(),
    notes: z.string(),
});

const SYSTEM = `You are a senior consultant reviewing the Inception-phase vision document
written by another agent. Your job is to challenge gaps and tighten it.

You receive:
- The original raw requirement
- The vision document the previous agent produced

You produce:
1. A REVISED vision document (the same shape: purpose, stakeholders, success criteria,
   scope, use cases, open questions). Strengthen weak sections; remove fluff; keep the
   sections the previous agent got right.
2. Short reviewer notes (3-8 bullets) describing what you changed and why.

Rules:
- Stay within the spirit of the requirement. Do not expand scope.
- If the previous agent missed an obvious stakeholder, success metric, or risk, add it.
- If something is over-specified for an Inception doc, prune it.
- Keep the revised vision 300-600 words. Plain Markdown.`;

export default async function visionReviewerRole({ requirement, vision }) {
    const user = `# Original requirement

${requirement}

# Vision document to review

${vision}

Produce the revised vision and your reviewer notes.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'vision_review_output',
        maxTokens: 8_000,
    });
    return {
        vision: result.data.revised_vision,
        notes: result.data.notes,
        usage: result.usage,
    };
}
