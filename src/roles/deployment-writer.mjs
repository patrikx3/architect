import { z } from 'zod';
import { callAnthropic } from '../providers/anthropic.mjs';

const Schema = z.object({
    deploy: z.string(),
});

const SYSTEM = `You are a senior DevOps engineer running RUP Transition.

You receive: the architecture, the file tree, and the produced source files.
You produce a 'deploy.md' document.

Structure:
- # Deployment & Operations
- ## Local development
  - prerequisites (runtime versions, system deps)
  - install (commands)
  - run (commands, ports, URLs)
  - environment variables (table: name, required?, default, purpose)
- ## Production deployment
  - target environment recommendation (Docker, plain Node, serverless, etc.)
  - build steps
  - runtime config & secrets handling
  - first-run setup (DB migrations, seed data, etc. — only if applicable)
- ## Operations
  - logs (where they go, what to look for)
  - health check endpoint or smoke test
  - common failure modes and how to recover
- ## Rollback strategy

Rules:
- Match the actual produced files. If the project is plain Node, do not invent Dockerfile steps.
  If a Dockerfile exists, reference it explicitly.
- Be concrete. Real commands, real ports, real env var names from the source.
- 500-1200 words. Plain Markdown.`;

export default async function deploymentWriterRole({ architecture, fileTree, files }) {
    const fileBlock = files
        .filter((f) => /(package\.json|Dockerfile|\.env\.example|README|index|server|app)/i.test(f.path))
        .slice(0, 8)
        .map((f) => `## ${f.path}\n\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``)
        .join('\n\n');

    const user = `# Architecture

${architecture}

# File tree

${JSON.stringify(fileTree, null, 2)}

# Key files (config, entry points)

${fileBlock}

Produce the deployment document.`;

    const result = await callAnthropic({
        system: SYSTEM,
        user,
        schema: Schema,
        schemaName: 'deployment_output',
        maxTokens: 8_000,
    });
    return { deploy: result.data.deploy, usage: result.usage };
}
