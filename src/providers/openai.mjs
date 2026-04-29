import OpenAI from 'openai';
import { zodToJsonSchema } from './schema.mjs';

// USD per 1M tokens. Update when prices change.
const RATES = {
    'gpt-5.5': { in: 5.00, out: 30.00 },
    'gpt-5': { in: 3.00, out: 10.00 },
    'gpt-5-mini': { in: 0.30, out: 1.20 },
    'gpt-5-nano': { in: 0.05, out: 0.20 },
    'gpt-4o': { in: 2.50, out: 10.00 },
};

let client = null;
const getClient = () => {
    if (!client) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY missing — see secure/.env.example');
        }
        client = new OpenAI();
    }
    return client;
};

export async function callOpenAI({ system, user, schema, schemaName, model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
    const response = await getClient().chat.completions.create({
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: schemaName,
                strict: true,
                schema: zodToJsonSchema(schema),
            },
        },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('OpenAI returned empty content');
    }

    const parsed = JSON.parse(content);
    const validated = schema.parse(parsed);

    const rates = RATES[model] || RATES['gpt-5.5'];
    const usage = {
        input: response.usage.prompt_tokens,
        output: response.usage.completion_tokens,
        usd: (response.usage.prompt_tokens * rates.in + response.usage.completion_tokens * rates.out) / 1_000_000,
        model,
    };

    return { data: validated, usage };
}
