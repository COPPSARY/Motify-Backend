import { describe, expect, it, vi } from 'vitest';

import { BakongApiError, BakongClient, bakongTokenExpiry } from '../../../packages/bakong/client.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function client(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { fetch, bakong: new BakongClient({ baseUrl: 'https://api-bakong.nbc.gov.kh/', token: 'token-123', fetch }) };
}

const transaction = {
  hash: '8465d722d7d5065f2886f0a474a4d34dc6a7855355b611836f7b6111228893e9',
  fromAccountId: 'payer@abaa',
  toAccountId: 'motify@aclb',
  currency: 'USD',
  amount: 20,
  description: null,
};

describe('BakongClient.checkTransactionByMd5', () => {
  it('posts the md5 with the bearer token and reports a paid transaction', async () => {
    const { fetch, bakong } = client(jsonResponse({ responseCode: 0, responseMessage: 'Getting transaction successfully.', errorCode: null, data: transaction }));

    await expect(bakong.checkTransactionByMd5('abc')).resolves.toEqual({ status: 'PAID', transaction });
    expect(fetch).toHaveBeenCalledWith('https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ md5: 'abc' }),
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    }));
  });

  it('maps Bakong error codes 1 and 3 to not found and failed', async () => {
    await expect(client(jsonResponse({ responseCode: 1, errorCode: 1, data: null })).bakong.checkTransactionByMd5('abc'))
      .resolves.toEqual({ status: 'NOT_FOUND' });
    await expect(client(jsonResponse({ responseCode: 1, errorCode: 3, data: null })).bakong.checkTransactionByMd5('abc'))
      .resolves.toEqual({ status: 'FAILED' });
  });

  it('throws on other Bakong error codes', async () => {
    await expect(client(jsonResponse({ responseCode: 1, errorCode: 6, responseMessage: 'Unauthorized.', data: null })).bakong.checkTransactionByMd5('abc'))
      .rejects.toMatchObject({ name: 'BakongApiError', errorCode: 6 });
  });

  it('explains HTTP failures, including the Cambodia-only 403', async () => {
    await expect(client(new Response('', { status: 403 })).bakong.checkTransactionByMd5('abc'))
      .rejects.toThrow(/IP in Cambodia/);
    await expect(client(new Response('', { status: 401 })).bakong.checkTransactionByMd5('abc'))
      .rejects.toMatchObject({ httpStatus: 401 });
    await expect(client(new TypeError('fetch failed')).bakong.checkTransactionByMd5('abc'))
      .rejects.toBeInstanceOf(BakongApiError);
  });
});

describe('bakongTokenExpiry', () => {
  it('reads the exp claim of a Bakong JWT', () => {
    // Sample token from NBC's Open API document.
    const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE2MjUxMTE1NDgsImlhdCI6MTYxNzA3NjM0OCwiZGF0YSI6eyJpZCI6ImQ0MDczMWQzZGM3YjRlMSJ9fQ.aPZFsTYT4oh2T5XAGcwobiDEJJF1wqqEoLkIDvq-hsM';
    expect(bakongTokenExpiry(token)?.toISOString()).toBe(new Date(1_625_111_548_000).toISOString());
  });

  it('returns null for tokens without a readable exp', () => {
    expect(bakongTokenExpiry('not-a-jwt')).toBeNull();
    expect(bakongTokenExpiry('a.b.c')).toBeNull();
  });
});
