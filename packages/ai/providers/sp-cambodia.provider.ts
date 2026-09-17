import OpenAI from 'openai';
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { z } from 'zod';

import {
    motionlyGenerationJsonSchema,
    normalizeProviderError,
    parseMotionlyGeneration,
    parseStructured,
    requireModelText,
    requestSignalOptions,
    tokenUsage,
    type ChatRequest,
    type ModelGenerationResult,
    type MotionModelProvider,
    type MotionModelRequest,
    type StructuredModelRequest,
} from './model.provider.js';

export const SP_CAMBODIA_BASE_URL = 'https://sp-cambo.store/v1';

interface SpCambodiaClient {
    responses: {
        create(body: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Response>;
    };
}

export interface SpCambodiaProviderOptions {
    apiKey: string;
    client?: SpCambodiaClient;
}

export class SpCambodiaMotionModelProvider implements MotionModelProvider {
    readonly name = 'sp-cambodia' as const;
    private readonly client: SpCambodiaClient;

    constructor(options: SpCambodiaProviderOptions) {
        if (!options.apiKey.trim()) throw new Error('SP Cambodia API key is required.');
        this.client = options.client ?? new OpenAI({
            apiKey: options.apiKey,
            baseURL: SP_CAMBODIA_BASE_URL,
        });
    }

    async generate(request: MotionModelRequest): Promise<ModelGenerationResult> {
        try {
            const response = await this.client.responses.create({
                model: request.model,
                instructions: request.systemInstructions,
                input: request.prompt,
                max_output_tokens: request.limits.maxOutputTokens,

                text: {
                    format: {
                        type: 'json_schema',
                        name: 'motionly_generation',
                        strict: true,
                        schema: motionlyGenerationJsonSchema,
                    },
                },
            }, ...requestSignalOptions(request.signal));
            return {
                generation: parseMotionlyGeneration(requireModelText(response.output_text)),
                usage: tokenUsage(response.usage?.input_tokens, response.usage?.output_tokens),
            };
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async structured<T>(request: StructuredModelRequest<T>): Promise<T> {
        try {
            const response = await this.client.responses.create({
                model: request.model,
                instructions: request.systemInstructions,
                input: request.prompt,
                max_output_tokens: request.limits.maxOutputTokens,

                text: {
                    format: {
                        type: 'json_schema',
                        name: request.schemaName,
                        strict: true,
                        schema: z.toJSONSchema(request.schema, { target: 'draft-7' }),
                    },
                },
            }, ...requestSignalOptions(request.signal));
            return parseStructured(requireModelText(response.output_text), request.schema);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }

    async chat(request: ChatRequest): Promise<string> {
        try {
            const response = await this.client.responses.create({
                model: request.model,
                instructions: request.systemInstructions,
                input: request.messages,
                max_output_tokens: request.limits.maxOutputTokens,

            }, ...requestSignalOptions(request.signal));
            return requireModelText(response.output_text);
        } catch (error) {
            throw normalizeProviderError(this.name, error, request.signal);
        }
    }
}
