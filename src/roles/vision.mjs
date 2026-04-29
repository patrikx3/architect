import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    vision: z.string(),
});

const SYSTEM = `You are a senior product strategist running RUP Inception.

You receive a raw requirement (often short, possibly ambiguous, possibly from a stakeholder
who hasn't thought through the edges). You produce a 'vision' Markdown document covering:

- Purpose & problem statement (what is broken without this)
- Stakeholders (who cares, what role they play)
- Success criteria (how we know it worked — measurable where possible)
- Scope: in / out / explicit non-goals
- High-level use cases or user journeys (3-7 bullets)
- Open questions the requirement does not answer (so the next phase can refine)

Rules:
- Be concise. 300-600 words total.
- Do not invent features outside the spirit of the requirement.
- Mark assumptions explicitly (use 'Assumption:' inline) so they are visible later.
- Plain Markdown. No frontmatter, no code fences around the whole doc.`;

export default async function visionRole({ requirement }) {
    const result = await callOpenAI({
        system: SYSTEM,
        user: `Requirement:\n\n${requirement}\n\nProduce the vision document.`,
        schema: Schema,
        schemaName: 'vision_output',
    });
    return { vision: result.data.vision, usage: result.usage };
}
