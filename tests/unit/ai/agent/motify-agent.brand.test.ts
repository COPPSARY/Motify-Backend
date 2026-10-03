import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import type { GenerationBrand } from '../../../../packages/ai/agent/dependencies.js';
import { readBrandDna } from '../../../../packages/brand/brand-dna.js';
import { project, repository, runnerFor, ScriptedModel } from './memory-harness.js';

const logoId = '00000000-0000-4000-8000-0000000000a1';

const brand: GenerationBrand = {
    dna: readBrandDna({
        identity: { name: 'Acme', tagline: 'Ship faster' },
        visual: { colors: [{ id: 'c1', name: 'Ink', hex: '#101820', role: 'background' }, { id: 'c2', hex: '#ff5a1f', role: 'accent' }] },
    }),
    assets: [
        { assetId: logoId, role: 'logo', label: null, fileName: 'logo.svg', contentType: 'image/svg+xml', width: 400, height: 120 },
    ],
};

const lastHuman = (messages: BaseMessage[]) => JSON.stringify(messages.filter((message) => message.getType() === 'human').at(-1)?.content);

async function request(input: { brand?: GenerationBrand }) {
    const { repo } = repository({ p1: project('p1') });
    const model = new ScriptedModel([new AIMessage('ok')]);
    await runnerFor(model, repo).invoke({ userId: 'u1', workspaceId: 'w1', projectId: 'p1', message: 'make a launch film', ...input });
    return lastHuman(model.seen[0]!);
}

describe('Brand DNA reaches the agent', () => {
    it('travels with the request: identity, palette and placeable logo', async () => {
        const sent = await request({ brand });

        expect(sent).toContain('make a launch film');
        expect(sent).toContain('BRAND DNA');
        expect(sent).toContain('Brand: Acme \\"Ship faster\\"');
        expect(sent).toContain('- background #101820 (Ink)');
        expect(sent).toContain('- accent #ff5a1f');
        expect(sent).toContain(`motify-asset://${logoId}`);
    });

    it('adds nothing when the person has no brand', async () => {
        const sent = await request({});

        expect(sent).not.toContain('BRAND DNA');
    });
});
