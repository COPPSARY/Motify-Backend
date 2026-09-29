import { createHash } from 'node:crypto';

import { BakongKHQR } from 'bakong-khqr';
import { describe, expect, it } from 'vitest';

import { generateDynamicKhqr, KhqrGenerationError } from '../../../packages/bakong/khqr.js';

const receiver = { accountId: 'motify@aclb', merchantName: 'Motify', merchantCity: 'Phnom Penh' };
const expiresAt = new Date(Date.now() + 10 * 60_000);

describe('generateDynamicKhqr', () => {
  it('encodes a valid dynamic KHQR for an individual account', () => {
    const khqr = generateDynamicKhqr(receiver, { amount: 20, currency: 'USD', billNumber: 'MTF-ABC123', expiresAt, storeLabel: 'Motify Pro' });

    expect(BakongKHQR.verify(khqr.qr).isValid).toBe(true);
    expect(khqr.md5).toBe(createHash('md5').update(khqr.qr).digest('hex'));
    const decoded = BakongKHQR.decode(khqr.qr).data;
    expect(decoded).toMatchObject({
      bakongAccountID: 'motify@aclb',
      merchantName: 'Motify',
      merchantCity: 'Phnom Penh',
      billNumber: 'MTF-ABC123',
      storeLabel: 'Motify Pro',
      transactionCurrency: '840',
      transactionAmount: '20',
      pointofInitiationMethod: '12',
      expirationTimestamp: String(expiresAt.getTime()),
    });
  });

  it('encodes a merchant account when merchant id and acquiring bank are set', () => {
    const khqr = generateDynamicKhqr(
      { ...receiver, merchantId: '123456', acquiringBank: 'ACLEDA Bank' },
      { amount: 10, currency: 'USD', billNumber: 'MTF-M1', expiresAt },
    );

    expect(BakongKHQR.decode(khqr.qr).data).toMatchObject({ merchantID: '123456', acquiringBank: 'ACLEDA Bank' });
  });

  it('produces a different QR, and so a different md5, per bill number', () => {
    const first = generateDynamicKhqr(receiver, { amount: 10, currency: 'USD', billNumber: 'MTF-ONE', expiresAt });
    const second = generateDynamicKhqr(receiver, { amount: 10, currency: 'USD', billNumber: 'MTF-TWO', expiresAt });
    expect(first.md5).not.toBe(second.md5);
  });

  it('rejects amounts that would make a static QR, and fields KHQR cannot hold', () => {
    expect(() => generateDynamicKhqr(receiver, { amount: 0, currency: 'USD', billNumber: 'MTF-0', expiresAt })).toThrow(KhqrGenerationError);
    expect(() => generateDynamicKhqr({ ...receiver, merchantName: 'M'.repeat(26) }, { amount: 10, currency: 'USD', billNumber: 'MTF-1', expiresAt }))
      .toThrow(KhqrGenerationError);
    expect(() => generateDynamicKhqr(receiver, { amount: 10, currency: 'USD', billNumber: 'B'.repeat(26), expiresAt }))
      .toThrow(KhqrGenerationError);
  });
});
