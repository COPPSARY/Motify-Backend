import { GeminiMotionModelProvider } from '../../packages/ai/providers/gemini.provider.js';

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) throw new Error('GEMINI_API_KEY is required for the opt-in Gemini smoke evaluation.');

const model = process.env.AI_MODEL?.trim();
if (!model) throw new Error('AI_MODEL is required for the opt-in Gemini smoke evaluation.');
const provider = new GeminiMotionModelProvider({ apiKey });
const startedAt = performance.now();
const generation = await provider.generate({
  model,
  systemInstructions: 'Return a valid minimal Motify composition. Use no external assets.',
  prompt: 'Create a one-second composition containing a single text scene and no animation tracks.',
  limits: { maxOutputTokens: 512 },
});

const passed = generation.scenes.length > 0
  && generation.compositionHtml.length > 0
  && generation.timelineJs.length > 0;
const report = {
  version: 1,
  passed,
  provider: provider.name,
  model,
  capabilities: { structuredMotifyGeneration: passed },
  sceneCount: generation.scenes.length,
  compositionHtmlBytes: Buffer.byteLength(generation.compositionHtml, 'utf8'),
  timelineJsBytes: Buffer.byteLength(generation.timelineJs, 'utf8'),
  elapsedMs: Math.round(performance.now() - startedAt),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 1;
