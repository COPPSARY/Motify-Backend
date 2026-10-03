import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from '@langchain/google-genai';

type JsonObject = Record<string, unknown>;

const UNSUPPORTED_KEYWORDS = new Set(['exclusiveMinimum', 'exclusiveMaximum', '$schema', 'additionalProperties', 'strict']);

/**
 * Rewrites a JSON Schema into the OpenAPI subset Gemini function declarations
 * accept. Gemini rejects `type` arrays (`["string","null"]`, which Zod's
 * `.nullable()` emits) and exclusive bounds with a 400, and expresses
 * nullability as `nullable: true` instead.
 */
export function sanitizeGeminiSchema(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(sanitizeGeminiSchema);
    if (node === null || typeof node !== 'object') return node;

    const source = node as JsonObject;
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(source)) {
        if (UNSUPPORTED_KEYWORDS.has(key)) continue;
        result[key] = sanitizeGeminiSchema(value);
    }

    if (Array.isArray(result.type)) {
        const types = result.type.filter((entry) => entry !== 'null');
        if (types.length < result.type.length) result.nullable = true;
        if (types.length === 1) result.type = types[0];
        else delete result.type;
    }

    for (const keyword of ['anyOf', 'oneOf'] as const) {
        const branches = result[keyword];
        if (!Array.isArray(branches)) continue;
        const nonNull = branches.filter((branch) => (branch as JsonObject | null)?.type !== 'null');
        if (nonNull.length === branches.length) continue;
        delete result[keyword];
        result.nullable = true;
        if (nonNull.length === 1) Object.assign(result, nonNull[0] as JsonObject);
        else if (nonNull.length > 1) result[keyword] = nonNull;
    }

    return result;
}

/**
 * `ChatGoogleGenerativeAI` forwards tool parameter schemas almost untouched, so
 * any tool whose schema uses a keyword Gemini rejects (deepagents' built-in
 * tools and MCP tools included) fails the whole request. Sanitizing in
 * `bindTools` covers every tool regardless of where it comes from.
 */
export class MotifyGeminiChatModel extends ChatGoogleGenerativeAI {
    override bindTools(tools: BindToolsInput[], kwargs?: Parameters<ChatGoogleGenerativeAI['bindTools']>[1]) {
        const sanitized = tools.map((entry) => {
            const converted = convertToOpenAITool(entry as never) as { type: 'function'; function: { name: string; description?: string; parameters: unknown } };
            return {
                ...converted,
                function: { ...converted.function, parameters: sanitizeGeminiSchema(converted.function.parameters) },
            };
        });
        return super.bindTools(sanitized as never, kwargs);
    }
}

export function createGeminiModel(fields: GoogleGenerativeAIChatInput): MotifyGeminiChatModel {
    return new MotifyGeminiChatModel(fields);
}
