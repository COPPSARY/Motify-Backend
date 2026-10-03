import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { project, repository, runnerFor, ScriptedModel } from './memory-harness.js';

type Row = { role: 'user' | 'assistant'; content: string };
const user = (content: string): Row => ({ role: 'user', content });
const assistant = (content: string): Row => ({ role: 'assistant', content });

/** What a strict provider accepts: after the system prompt, the first message is the user's and roles alternate. */
function problem(messages: BaseMessage[]): string | undefined {
    const conversation = messages.filter((message) => message.getType() !== 'system');
    if (conversation[0]?.getType() !== 'human') return `first message is ${conversation[0]?.getType()}, not human`;
    for (let i = 1; i < conversation.length; i += 1) {
        if (conversation[i]!.getType() === conversation[i - 1]!.getType()) return `two ${conversation[i]!.getType()} messages in a row at ${i}`;
    }
    return undefined;
}

const roles = (messages: BaseMessage[]) => messages.filter((message) => message.getType() !== 'system').map((message) => message.getType());
const text = (message: BaseMessage) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content));

async function firstRequest(history: Row[], options: { message?: string } = {}) {
    const { repo } = repository({ p1: project('p1') }, history);
    const model = new ScriptedModel([new AIMessage('ok')]);
    const runner = runnerFor(model, repo);

    await runner.invoke({ userId: 'u1', workspaceId: 'w1', projectId: 'p1', message: options.message ?? 'new request' });

    return model.seen[0]!;
}

describe('the conversation rebuilt from the saved chat', () => {
    const messy = [
        assistant('old reply cut off by the window'),
        user('q1'), user('q2'), user('q3'),
        assistant('a real answer'),
        user('unanswered one'), user('unanswered two'),
    ];

    it('starts with the user and alternates, even when the saved chat does not', async () => {
        const sent = await firstRequest(messy);

        expect(problem(sent)).toBeUndefined();
        expect(roles(sent)).toEqual(['human', 'ai', 'human']);
    });

    it('keeps what the user said: runs of messages are joined, and unanswered ones travel with the new request', async () => {
        const sent = await firstRequest(messy);
        const conversation = sent.filter((message) => message.getType() !== 'system');

        expect(text(conversation[0]!)).toContain('q1');
        expect(text(conversation[0]!)).toContain('q3');
        expect(text(conversation[1]!)).toContain('a real answer');
        expect(text(conversation[2]!)).toContain('unanswered one');
        expect(text(conversation[2]!)).toContain('unanswered two');
        expect(text(conversation[2]!)).toContain('new request');
    });

    it('drops a leading assistant message that has no question before it', async () => {
        const sent = await firstRequest(messy);

        expect(JSON.stringify(sent)).not.toContain('old reply cut off by the window');
    });

    it('leaves an already well-formed history as it was', async () => {
        const sent = await firstRequest([user('hello'), assistant('hi there')]);

        expect(roles(sent)).toEqual(['human', 'ai', 'human']);
        expect(text(sent.filter((message) => message.getType() !== 'system')[2]!)).toContain('new request');
    });

    it('sends just the request when there is no history', async () => {
        const sent = await firstRequest([]);

        expect(roles(sent)).toEqual(['human']);
    });

    it('keeps attached images when it folds unanswered messages into the new request', async () => {
        const { repo } = repository({ p1: project('p1') }, [user('earlier ask')]);
        const model = new ScriptedModel([new AIMessage('ok')]);

        await runnerFor(model, repo).invoke({
            userId: 'u1', workspaceId: 'w1', projectId: 'p1', message: 'use this logo',
            assets: [{ assetId: 'a1', fileName: 'logo.png', mediaType: 'image/png', dataBase64: 'aGk=', role: 'asset' }],
        });

        const sent = model.seen[0]!;
        const last = sent.filter((message) => message.getType() !== 'system').at(-1)!;
        expect(problem(sent)).toBeUndefined();
        expect(JSON.stringify(last.content)).toContain('image_url');
        expect(JSON.stringify(last.content)).toContain('earlier ask');
        expect(JSON.stringify(last.content)).toContain('use this logo');
    });

    it('does not repeat the current message when it is already saved as the last unanswered one', async () => {
        const sent = await firstRequest([user('make it'), user('make it')], { message: 'make it' });
        const conversation = sent.filter((message) => message.getType() !== 'system');

        expect(roles(sent)).toEqual(['human']);
        expect(text(conversation[0]!)).toBe('make it');
    });

    it('still carries earlier, different unanswered messages, and says the current one once', async () => {
        const sent = await firstRequest([user('first idea'), user('make it'), user('make it')], { message: 'make it' });
        const last = text(sent.filter((message) => message.getType() !== 'system').at(-1)!);

        expect(last).toContain('first idea');
        expect(last.match(/make it/g)).toHaveLength(1);
    });
});
