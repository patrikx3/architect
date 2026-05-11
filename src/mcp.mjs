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
// staring at silence for the 30-180s a dossier takes.
const server = new McpServer(
    { name: 'p3x-architect', version: '2026.4.1' },
    {
        capabilities: { logging: {} },
        instructions:
            'P3X Architect MCP — DESIGN-ONLY dossier generator. Two AIs (Claude + Codex) cross-check each other to produce a RUP design dossier: conventions, vision, requirements, architecture, file_tree, risks, design-findings. NEVER writes code into the project. The dossier lives at agents/<slug>/. Hand it to your implementer (Claude Code, Cursor, the human, the team). Default = pair mode (quick design pass, ~30-60s). Pass `rup: true` for the full 7-role multi-agent dossier (Inception → Elaboration, ~1-3 min). Streams live progress via notifications/message + notifications/progress.',
    },
);

server.registerTool(
    'architect',
    {
        title: 'Architect — RUP design dossier generator (2 AIs cross-checking, no code writes)',
        description:
            'Generates a DESIGN DOSSIER. Never writes code into the project. Default = pair mode (scout (Codex) + pair-planner (Claude) → plan.md + file_tree.json + conventions.md, ~30-60s). Pass `rup: true` for the full 7-role RUP dossier (Inception → Elaboration, ~1-3 min): conventions, vision, requirements, architecture, file_tree, risks, design-review + design-findings. Dossier lands under <project_root>/agents/<slug>/ — hand it to your implementer (Claude Code, Cursor, you, your team) to actually build. Uses local `claude` + `codex` CLIs (subscription mode = $0 marginal cost).',
        inputSchema: {
            requirement: z
                .string()
                .describe('Plain-language requirement, task, or feature spec from the stakeholder. Can be one paragraph or several pages of Markdown.'),
            rup: z
                .boolean()
                .optional()
                .describe('Set to true to run the full 7-role RUP design dossier (Inception → Elaboration). Use when designing something complex enough to warrant a full vision/requirements/architecture/risks dossier. Default false = fast pair mode (scout + planner, 2 AIs).'),
            slug: z
                .string()
                .optional()
                .describe('Folder name under agents/. Auto-derived from the requirement if omitted.'),
            project_root: z
                .string()
                .optional()
                .describe('Absolute path to the project root to scan for layout conventions. The dossier lands under <project_root>/agents/<slug>/. No code is written into the project. Defaults to the MCP server cwd.'),
            budget_usd: z
                .number()
                .min(0)
                .optional()
                .describe('Cumulative USD budget across all roles. 0 = unlimited. Default: ARCHITECT_BUDGET_USD env var or 5. (CLI subscription mode is $0.)'),
        },
    },
    async ({ requirement, rup, slug, project_root, budget_usd }, extra) => {
        const finalSlug = slug ?? slugify(requirement.slice(0, 40));
        const finalRoot = project_root ?? process.cwd();
        const finalBudget = budget_usd ?? Number(process.env.ARCHITECT_BUDGET_USD ?? 5);
        const mode = rup === true ? 'rup' : 'pair';

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
                mode,
                budgetUsd: finalBudget,
                log: forward,
            });
            const summary = {
                ok: true,
                slug: finalSlug,
                pipeline_mode: result.pipelineMode,
                base_dir: result.baseDir,
                project_root: result.projectRoot,
                verdict: result.verdict,
                file_tree_entries: result.fileTree?.length ?? 0,
                target_mode: result.mode,
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
