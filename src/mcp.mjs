import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { architect } from './orchestrator.mjs';

function slugify(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'unnamed';
}

// `logging: {}` advertises that the server emits notifications/message — Claude Code
// and other MCP clients render those inline as the tool runs, instead of the user
// staring at silence for the 1–3 minutes a pipeline takes.
const server = new McpServer(
    { name: 'p3x-architect', version: '2026.4.1' },
    {
        capabilities: { logging: {} },
        instructions:
            'P3X Architect MCP — multi-agent RUP pipeline. Calls OpenAI + Claude through Inception → Elaboration → Construction → Transition, generating a full design and implementation under agents/<slug>/. Use the architect tool with a plain-language requirement; pipeline runs may take 30s–several minutes and stream live progress via notifications/message + notifications/progress.',
    },
);

server.registerTool(
    'architect',
    {
        title: 'Architect — multi-agent RUP pipeline',
        description:
            'Generate a full design (vision, requirements, architecture, file_tree, risks, design review) and a code implementation (with critic↔reviser rounds) plus acceptance + deployment docs, all under <project_root>/agents/<slug>/. Uses OpenAI + Claude. Slow (30–120s) and not cheap (~$1–$5 per run with default models).',
        inputSchema: {
            requirement: z
                .string()
                .describe('Plain-language requirement, task, or feature spec from the stakeholder. Can be one paragraph or several pages of Markdown.'),
            slug: z
                .string()
                .optional()
                .describe('Folder name under agents/. Auto-derived from the requirement if omitted.'),
            project_root: z
                .string()
                .optional()
                .describe('Absolute path to the target project root (output goes to <project_root>/agents/<slug>/). Defaults to the MCP server cwd.'),
            max_rounds: z
                .number()
                .int()
                .min(1)
                .max(5)
                .optional()
                .describe('Maximum critic↔reviser rounds in Construction (default 2).'),
            budget_usd: z
                .number()
                .min(0)
                .optional()
                .describe('Cumulative USD budget across all roles. 0 = unlimited. Default: ARCHITECT_BUDGET_USD env var or 5.'),
        },
    },
    async ({ requirement, slug, project_root, max_rounds, budget_usd }, extra) => {
        const finalSlug = slug ?? slugify(requirement.slice(0, 40));
        const finalRoot = project_root ?? process.cwd();
        const finalBudget = budget_usd ?? Number(process.env.ARCHITECT_BUDGET_USD ?? 5);
        const finalRounds = max_rounds ?? 2;

        const logLines = [];
        const progressToken = extra?._meta?.progressToken;
        let progressStep = 0;

        // Forward each orchestrator log line live so the MCP client (Claude Code,
        // Cursor, etc.) shows progress while the pipeline runs — instead of a 30s+
        // black box that finally returns at the end. Three channels:
        //   1. process.stderr — picked up by every MCP host and shown in their log panel
        //   2. notifications/message — clients with logging capability render this
        //   3. notifications/progress — clients showing progress UI animate this
        const forward = (msg) => {
            logLines.push(msg);
            process.stderr.write(`[p3x-architect] ${msg}\n`);
            server.sendLoggingMessage({ level: 'info', logger: 'p3x-architect', data: msg })
                .catch(() => { /* client has no logging capability — fine */ });
            if (progressToken != null && extra?.sendNotification) {
                progressStep += 1;
                extra.sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken, progress: progressStep, message: msg },
                }).catch(() => { /* client has no progress capability — fine */ });
            }
        };

        try {
            const result = await architect({
                requirement,
                slug: finalSlug,
                projectRoot: finalRoot,
                maxRounds: finalRounds,
                budgetUsd: finalBudget,
                log: forward,
            });
            const summary = {
                ok: true,
                slug: finalSlug,
                base_dir: result.baseDir,
                project_dir: result.projectDir,
                verdict: result.verdict,
                files: result.files.length,
                remaining_blocking_issues: result.issues.filter(
                    (i) => i.severity === 'high' || i.severity === 'medium',
                ).length,
                total_usd: Number(result.usage.totalUsd.toFixed(4)),
                per_role: result.usage.perRole.map((r) => ({
                    role: r.role,
                    model: r.model,
                    usd: Number(r.usd.toFixed(4)),
                    input_tokens: r.input,
                    output_tokens: r.output,
                })),
                log: logLines,
            };
            return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
        } catch (err) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            {
                                ok: false,
                                error: err.message,
                                log: logLines,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        }
    },
);

const transport = new StdioServerTransport();
await server.connect(transport);
