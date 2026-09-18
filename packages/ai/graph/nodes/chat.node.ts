import { CHAT_SYSTEM_PROMPT, CONVERSATION_LIMITS } from '../../prompts/router.prompt.js';
import type { ResolvedMotionGraphDependencies } from '../dependencies.js';
import type { MotionGraphState, MotionGraphUpdate } from '../state.js';

/** Answers the user without touching project state. */
export function createChatNode(dependencies: ResolvedMotionGraphDependencies) {
    return async (state: MotionGraphState): Promise<MotionGraphUpdate> => {
        const message = await dependencies.provider.chat({
                model: dependencies.model,
                systemInstructions: CHAT_SYSTEM_PROMPT,
                messages: [...state.recentMessages, { role: 'user', content: state.message }],
                limits: CONVERSATION_LIMITS,
                images: state.assets,
            });
        return {
            response: {
                type: 'chat',
                message: isCannedChatRefusal(message) ? 'Hi! What would you like to create today?' : message,
            },
        };
    };
}

function isCannedChatRefusal(message: string): boolean {
    return /looks like i can['’]?t (?:chat about|respond to) this/i.test(message);
}
