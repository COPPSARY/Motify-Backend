import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { StructuredToolInterface } from '@langchain/core/tools';

export interface KiriTtsConfig {
    url: string;
    accessToken: string;
}

/**
 * Kiri TTS (https://www.kiritts.com/mcp) — Khmer/English speech synthesis,
 * transcription, and voice cloning, exposed as MCP tools. Motify Backend
 * connects as one shared service account (per spec §3.12), not per end user.
 *
 * Fetched once at server startup; the returned tools are stateless-ish
 * wrappers around the shared `MultiServerMCPClient` connection and are safe
 * to reuse across every request's agent construction.
 */
export async function createKiriTtsTools(config: KiriTtsConfig): Promise<StructuredToolInterface[]> {
    const client = new MultiServerMCPClient({
        kiritts: {
            transport: 'http',
            url: config.url,
            headers: { Authorization: `Bearer ${config.accessToken}` },
        },
    });
    return client.getTools();
}
