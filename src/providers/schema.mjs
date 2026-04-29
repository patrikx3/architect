import { z } from 'zod';

// Zod 4 ships z.toJSONSchema natively. We post-process the output for compatibility
// with both OpenAI structured outputs (json_schema strict mode) and Anthropic tool use:
//   - both providers reject $ref/$defs at the top level when strict
//   - OpenAI strict mode requires additionalProperties:false on every object
//   - both want every property listed in 'required' (optionals must be modeled with .nullable())
export function zodToJsonSchema(schema) {
    const raw = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    return inlineRefs(raw);
}

function inlineRefs(node, defs = node.$defs ?? {}) {
    if (Array.isArray(node)) return node.map((n) => inlineRefs(n, defs));
    if (node === null || typeof node !== 'object') return node;
    if (typeof node.$ref === 'string') {
        const name = node.$ref.replace(/^#\/\$defs\//, '');
        const target = defs[name];
        if (target) return inlineRefs({ ...target }, defs);
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === '$defs' || key === '$schema') continue;
        out[key] = inlineRefs(value, defs);
    }
    if (out.type === 'object' && out.properties) {
        out.additionalProperties = false;
        out.required = Object.keys(out.properties);
    }
    return out;
}
