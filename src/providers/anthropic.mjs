import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from './schema.mjs';

const RATES = {
    'claude-opus-4-7': { in: 15.00, out: 75.00 },
    'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
    'claude-haiku-4-5': { in: 1.00, out: 5.00 },
};

let client = null;
const getClient = () => {
    if (!client) {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY missing — see secure/.env.example');
        }
        client = new Anthropic();
    }
    return client;
};

export async function callAnthropic({ system, user, schema, schemaName, model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-7', maxTokens = 16_000 }) {
    const response = await getClient().messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [{
            name: schemaName,
            description: `Submit ${schemaName} result.`,
            input_schema: zodToJsonSchema(schema),
        }],
        tool_choice: { type: 'tool', name: schemaName },
        messages: [
            { role: 'user', content: user },
        ],
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse) {
        throw new Error('Anthropic returned no tool_use block');
    }

    const validated = schema.parse(toolUse.input);

    const rates = RATES[model] || RATES['claude-opus-4-7'];
    const usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        usd: (response.usage.input_tokens * rates.in + response.usage.output_tokens * rates.out) / 1_000_000,
        model,
    };

    return { data: validated, usage };
}
