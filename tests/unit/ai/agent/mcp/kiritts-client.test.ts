import { describe, expect, it, vi } from 'vitest';

vi.mock('@langchain/mcp-adapters', () => ({
    MultiServerMCPClient: vi.fn().mockImplementation(function() {
        return {
            getTools: vi.fn(async () => [{ name: 'synthesize_speech' }]),
        };
    }),
}));

import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createKiriTtsTools } from '../../../../../packages/ai/agent/mcp/kiritts-client.js';

describe('createKiriTtsTools', () => {
    it('connects with a bearer-token Authorization header and returns the server\'s tools', async () => {
        const tools = await createKiriTtsTools({ url: 'https://mcp.kiritts.com/mcp', accessToken: 'test-token' });

        expect(MultiServerMCPClient).toHaveBeenCalledWith({
            kiritts: {
                transport: 'http',
                url: 'https://mcp.kiritts.com/mcp',
                headers: { Authorization: 'Bearer test-token' },
            },
        });
        expect(tools).toEqual([{ name: 'synthesize_speech' }]);
    });
});
