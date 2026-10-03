import { describe, expect, it, vi } from 'vitest';

import type { MotionGraphInput, MotionGraphResponse } from '../../../packages/ai/agent/dependencies.js';
import { ModelProviderError } from '../../../packages/ai/agent/errors.js';
import { recordModelUsage } from '../../../packages/ai/usage/usage-meter.js';
import { AppError } from '../../../src/errors.js';
import { GenerationBilling } from '../../../src/services/generation-billing.js';
import { GenerationService } from '../../../src/services/generation.service.js';

const WORKSPACE_ID = '26ce88b5-1a51-4265-913e-203eb3cadbd7';
const PROJECT_ID = '9a4f2e10-7b53-4a1c-9f0d-2c8b6d5e1a33';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const pricing = {
  inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10, usdPerCredit: 0.0416,
  minChargeUnits: 50, maxChargeUnits: 3_000, unreportedChargeUnits: 1_000,
};

interface Options {
  role?: 'owner' | 'editor' | 'viewer' | null;
  response?: MotionGraphResponse;
  error?: unknown;
  /** Tokens the fake graph reports to the meter before it answers or fails. */
  spend?: [number, number];
}

function harness(options: Options = {}) {
  const role = options.role === undefined ? 'editor' : options.role;
  const projects = { loadProjectAccess: vi.fn(async () => (role ? { workspaceId: WORKSPACE_ID, role } : null)) };
  const graph = {
    invoke: vi.fn(async (_input: MotionGraphInput) => {
      if (options.spend) recordModelUsage(options.spend[0], options.spend[1]);
      if (options.error) throw options.error;
      return { response: options.response ?? ({ type: 'chat', message: 'Motify is ready.' } as MotionGraphResponse) };
    }),
  };
  const ledger = {
    reserve: vi.fn().mockResolvedValue({ held: 1_000, balance: 4_000 }),
    settle: vi.fn().mockResolvedValue({ charged: 337, balance: 4_663 }),
    refund: vi.fn().mockResolvedValue({ refunded: 1_000 }),
    releaseStaleHolds: vi.fn(),
  };
  const billing = new GenerationBilling(ledger, pricing, { enforced: true, holdUnits: 1_000, minUnits: 50, staleAfterMs: 1 }, 'm');
  return { service: new GenerationService(graph, projects, undefined, undefined, billing), graph, ledger };
}

describe('GenerationService credits', () => {
  it('charges what the whole run spent, across every model call it made', async () => {
    const { service, ledger } = harness({ spend: [30_000, 8_000] });
    const result = await service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make it bigger' });

    expect(ledger.settle).toHaveBeenCalledWith(USER_ID, expect.any(String), expect.objectContaining({
      costUnits: 337, inputTokens: 30_000, outputTokens: 8_000,
    }));
    expect(result).toMatchObject({ type: 'chat', credits: { charged: 3.37, remaining: 46.63 } });
    expect(ledger.refund).not.toHaveBeenCalled();
  });

  it('charges nothing and refunds when the model never produced a valid film', async () => {
    const { service, ledger } = harness({
      spend: [150_000, 50_000],
      response: { type: 'error', code: 'GENERATION_INVALID', message: 'No.', errors: [] },
    });
    await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a film' })).rejects.toMatchObject({ code: 'GENERATION_INVALID' });
    expect(ledger.refund).toHaveBeenCalledTimes(1);
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it('refunds when the project changed underneath the request', async () => {
    const { service, ledger } = harness({
      response: { type: 'error', code: 'REVISION_CONFLICT', message: 'Moved.', currentRevision: 9 },
    });
    await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Edit' })).rejects.toMatchObject({ status: 409 });
    expect(ledger.refund).toHaveBeenCalledTimes(1);
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it('refunds when the provider fails part-way through', async () => {
    const { service, ledger } = harness({
      spend: [80_000, 20_000],
      error: new ModelProviderError('PROVIDER_TIMEOUT', 'slow', true),
    });
    await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a film' })).rejects.toMatchObject({ status: 504 });
    expect(ledger.refund).toHaveBeenCalledTimes(1);
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it('refunds on an unexpected crash too', async () => {
    const { service, ledger } = harness({ error: new Error('boom') });
    await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a film' })).rejects.toThrow('boom');
    expect(ledger.refund).toHaveBeenCalledTimes(1);
  });

  it('stops with 402 before any model runs when the account cannot pay', async () => {
    const { service, graph, ledger } = harness();
    ledger.reserve.mockResolvedValue({ held: 0, balance: 10 });
    await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Make a film' })).rejects.toMatchObject({
      status: 402, code: 'INSUFFICIENT_CREDITS', details: { balance: 0.1, required: 0.5 },
    });
    expect(graph.invoke).not.toHaveBeenCalled();
    expect(ledger.settle).not.toHaveBeenCalled();
    expect(ledger.refund).not.toHaveBeenCalled();
  });

  it('never touches credits for a request that is refused for access reasons', async () => {
    for (const role of [null, 'viewer'] as const) {
      const { service, ledger } = harness({ role });
      await expect(service.sendMessage(USER_ID, PROJECT_ID, { message: 'Hello' })).rejects.toBeInstanceOf(AppError);
      expect(ledger.reserve).not.toHaveBeenCalled();
    }
  });

  it('does not mix the usage of two requests running at once', async () => {
    const first = harness({ spend: [30_000, 8_000] });
    const second = harness({ spend: [150_000, 50_000] });
    await Promise.all([
      first.service.sendMessage(USER_ID, PROJECT_ID, { message: 'a' }),
      second.service.sendMessage(USER_ID, PROJECT_ID, { message: 'b' }),
    ]);
    expect(first.ledger.settle).toHaveBeenCalledWith(USER_ID, expect.any(String), expect.objectContaining({ inputTokens: 30_000 }));
    expect(second.ledger.settle).toHaveBeenCalledWith(USER_ID, expect.any(String), expect.objectContaining({ inputTokens: 150_000 }));
  });

  it('adds no credits field when billing is off', async () => {
    const projects = { loadProjectAccess: vi.fn(async () => ({ workspaceId: WORKSPACE_ID, role: 'editor' as const })) };
    const graph = { invoke: vi.fn(async () => ({ response: { type: 'chat', message: 'Hi' } as MotionGraphResponse })) };
    const result = await new GenerationService(graph, projects).sendMessage(USER_ID, PROJECT_ID, { message: 'Hi' });
    expect(result).toEqual({ type: 'chat', response: 'Hi' });
  });
});
