import { z } from 'zod';
import { callOpenAI } from '../providers/openai.mjs';

const Schema = z.object({
    risks: z.array(z.object({
        id: z.string(),
        category: z.enum(['technical', 'schedule', 'scope', 'operational', 'security', 'compliance']),
        severity: z.enum(['high', 'medium', 'low']),
        description: z.string(),
        mitigation: z.string(),
    })),
    summary: z.string(),
});

const SYSTEM = `You are a senior risk analyst running RUP Elaboration.

You receive the vision, the requirements, and the architecture. You produce a list of
risks the project should be aware of, with concrete mitigation strategies.

Categories:
- technical: design choice may not scale / integrate / perform
- schedule: estimation, dependencies, blocking unknowns
- scope: ambiguity, creep, conflicting requirements
- operational: deployment, monitoring, incident response
- security: auth, data protection, attack surface
- compliance: regulatory, licensing, accessibility

Rules:
- Each risk gets a stable id (RK001, RK002, …).
- Severity is honest: high = could derail the project; medium = expensive but recoverable;
  low = worth tracking but unlikely to dominate.
- Mitigation is actionable, not generic. "Add tests" is not actionable. "Add integration
  tests for the X→Y boundary because Z's API is undocumented" is.
- Aim for 5-15 risks. Quality over quantity.
- 'summary' is 2-4 sentences describing the overall risk posture.`;

export default async function riskAnalystRole({ vision, requirements, architecture }) {
    const user = `# Vision

${vision}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Architecture

${architecture}

Produce the risk list and summary.`;

    const result = await callOpenAI({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'risk_output',
    });
    return {
        risks: result.data.risks,
        summary: result.data.summary,
        usage: result.usage,
    };
}
