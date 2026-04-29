import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    review: z.string(),
    findings: z.array(z.object({
        severity: z.enum(['high', 'medium', 'low']),
        target: z.enum(['requirements', 'architecture', 'file_tree', 'risks']),
        finding: z.string(),
        suggestion: z.string(),
    })),
    verdict: z.enum(['ready-to-build', 'fix-then-build', 'redesign']),
});

const SYSTEM = `You are a senior reviewer closing out RUP Elaboration. Your job is to decide
whether the design is ready for Construction.

You receive: the vision, the requirements, the architecture, the file_tree, and the risk list.

You produce:
1. 'review': a 200-500 word Markdown review of the design quality (what's strong, what's weak)
2. 'findings': a list of specific gaps or contradictions (severity + which artifact +
   what is wrong + what to do about it). Empty array is valid if the design is clean.
3. 'verdict':
   - 'ready-to-build' = construction can begin
   - 'fix-then-build' = construction can begin once the high-severity findings are addressed
   - 'redesign' = the design has fundamental problems that require restarting Elaboration

Rules:
- Be specific. Cite requirement IDs (R001), risk IDs (RK001), and file_tree paths.
- A 'redesign' verdict is rare — only when the design fails the must-have requirements.
- Do not invent issues to look thorough.`;

export default async function designReviewerRole({ vision, requirements, architecture, fileTree, risks }) {
    const user = `# Vision

${vision}

# Requirements

${JSON.stringify(requirements, null, 2)}

# Architecture

${architecture}

# File tree

${JSON.stringify(fileTree, null, 2)}

# Risks

${JSON.stringify(risks, null, 2)}

Review the design. Produce the review markdown, findings array, and verdict.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'design_review_output',
        maxTokens: 8_000,
    });
    return {
        review: result.data.review,
        findings: result.data.findings,
        verdict: result.data.verdict,
        usage: result.usage,
    };
}
