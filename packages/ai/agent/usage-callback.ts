import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs';

import { recordModelUsage } from '../usage/usage-meter.js';

/**
 * Minimal type to extract usage_metadata without triggering generic type inference.
 * This avoids the `never` type that results from casting to the generic `AIMessage` class.
 */
interface UsageMetadataCarrier {
    usage_metadata?: {
        input_tokens: number;
        output_tokens: number;
        input_token_details?: { cache_read?: number };
    };
}

/**
 * Reports every model call's token usage to the request's `UsageMeter`
 * (`packages/ai/usage/usage-meter.js`), the way every hand-written provider
 * used to via a direct `recordModelUsage` call. Passed to `agent.invoke(input,
 * { callbacks: [new MotifyUsageCallbackHandler()] })` so it fires for every
 * model call the agent makes, however many steps the run takes.
 */
export class MotifyUsageCallbackHandler extends BaseCallbackHandler {
    name = 'motify-usage-callback';

    override handleLLMEnd(output: LLMResult, _runId: string): void {
        const generation = output.generations[0]?.[0] as ChatGeneration | undefined;
        const usage = (generation?.message as UsageMetadataCarrier | undefined)?.usage_metadata;
        recordModelUsage(usage?.input_tokens ?? null, usage?.output_tokens ?? null, usage?.input_token_details?.cache_read);
    }
}
