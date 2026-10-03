import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export function withContextBudget<T extends BaseChatModel>(model: T, maxInputTokens: number): T {
    Object.defineProperty(model, 'profile', { value: { maxInputTokens }, configurable: true });
    return model;
}
