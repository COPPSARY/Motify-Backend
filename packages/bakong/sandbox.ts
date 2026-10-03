import { randomBytes } from 'node:crypto';

import type { BakongTransaction, TransactionLookup } from './client.js';

/** What the simulated payer's bank does with a checkout. */
export type SandboxOutcome = 'paid' | 'failed' | 'wrong_amount';

export const SANDBOX_PAYER_ACCOUNT = 'sandbox.payer@devb';

/**
 * Stands in for the Bakong Open API in BAKONG_MODE=sandbox. Nothing leaves the
 * process and no request quota is spent: a checkout stays unpaid until a
 * developer calls `simulate`, and lookups then answer the way Bakong would.
 * Simulated results live in memory, so they last until the API restarts.
 */
export class SandboxBakongGateway {
  private readonly results = new Map<string, TransactionLookup>();

  simulate(md5: string, outcome: SandboxOutcome, expected: { amount: number; currency: string; toAccountId: string }) {
    if (outcome === 'failed') {
      this.results.set(md5, { status: 'FAILED' });
      return;
    }
    const transaction: BakongTransaction = {
      hash: `sandbox-${randomBytes(28).toString('hex')}`,
      fromAccountId: SANDBOX_PAYER_ACCOUNT,
      toAccountId: expected.toAccountId,
      currency: expected.currency,
      // A cent short: what a payer typing their own amount into a static QR could send.
      amount: outcome === 'wrong_amount' ? Math.round(expected.amount * 100 - 1) / 100 : expected.amount,
      description: 'Motify sandbox payment',
    };
    this.results.set(md5, { status: 'PAID', transaction });
  }

  async checkTransactionByMd5(md5: string): Promise<TransactionLookup> {
    return this.results.get(md5) ?? { status: 'NOT_FOUND' };
  }
}
