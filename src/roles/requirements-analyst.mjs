import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    requirements: z.array(z.object({
        id: z.string(),
        category: z.enum(['functional', 'non-functional', 'out-of-scope']),
        priority: z.enum(['must', 'should', 'could', 'wont']),
        text: z.string(),
        rationale: z.string(),
    })),
});

const SYSTEM = `You are a senior requirements analyst running RUP Elaboration.

You receive the Inception vision document. You produce a structured list of requirements.

Categorize each:
- functional: behavior the system must exhibit
- non-functional: quality attribute (performance, security, observability, accessibility, etc.)
- out-of-scope: explicit non-goals, captured to prevent scope creep

Prioritize each (MoSCoW):
- must: the system fails without this
- should: high value, but a v1 could ship without
- could: nice-to-have
- wont: explicitly deferred

Rules:
- Each requirement gets a stable id (R001, R002, …) and a single-sentence statement.
- Rationale (one sentence) explains why the requirement exists, tied to the vision.
- Aim for 10-30 requirements. Fewer is fine if the scope is narrow.
- Do not invent requirements not implied by the vision.`;

export default async function requirementsAnalystRole({ vision }) {
    const result = await callOpenAI({
        system: SYSTEM,
        user: `Vision:\n\n${vision}\n\nProduce the requirements list.`,
        schema: Schema,
        schemaName: 'requirements_output',
    });
    return { requirements: result.data.requirements, usage: result.usage };
}
