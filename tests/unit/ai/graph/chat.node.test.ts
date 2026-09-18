import { describe, expect, it, vi } from 'vitest';
import { createChatNode } from '../../../../packages/ai/graph/nodes/chat.node.js';
import { createPlanNode } from '../../../../packages/ai/graph/nodes/plan.node.js';
import type { ResolvedMotionGraphDependencies } from '../../../../packages/ai/graph/dependencies.js';
import type { MotionGraphState } from '../../../../packages/ai/graph/state.js';
import { chatMessagesWithImages } from '../../../../packages/ai/providers/model.provider.js';

const reference = { assetId: 'r', fileName: 'ref.png', mediaType: 'image/png' as const, dataBase64: 'AA==', role: 'reference' as const };

describe('conversational replies with images', () => {
    it.each([['chat', createChatNode], ['plan', createPlanNode]] as const)('%s sees attached images', async (_name, create) => {
        const chat = vi.fn().mockResolvedValue('ok');
        const node = create({ model: 'm', provider: { chat } } as unknown as ResolvedMotionGraphDependencies);

        await node({ message: 'What is in my reference?', recentMessages: [], assets: [reference] } as unknown as MotionGraphState);

        expect(chat).toHaveBeenCalledWith(expect.objectContaining({ images: [reference] }));
    });

    it('attaches images only to the newest user message', () => {
        const messages = chatMessagesWithImages([
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'reply' },
            { role: 'user', content: 'look' },
        ], [reference]);

        expect(messages[0]).toEqual({ role: 'user', content: 'first' });
        expect(messages[2]).toMatchObject({ role: 'user', content: [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
        ] });
    });
});
