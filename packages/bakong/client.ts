export interface BakongTransaction {
  hash: string;
  fromAccountId: string;
  toAccountId: string;
  currency: string;
  amount: number;
  description?: string | null;
}

export type TransactionLookup =
  | { status: 'PAID'; transaction: BakongTransaction }
  | { status: 'NOT_FOUND' }
  | { status: 'FAILED' };

export class BakongApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the request reached Bakong. 403 usually means the caller's IP is outside Cambodia. */
    readonly httpStatus: number | null,
    readonly errorCode: number | null = null,
  ) {
    super(message);
    this.name = 'BakongApiError';
  }
}

interface BakongEnvelope<T> {
  responseCode: number;
  responseMessage?: string | null;
  errorCode?: number | null;
  data?: T | null;
}

const TRANSACTION_NOT_FOUND = 1;
const TRANSACTION_FAILED = 3;

export interface BakongClientOptions {
  /** `https://api-bakong.nbc.gov.kh`, the SIT host, or a proxy in Cambodia that forwards to either. */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Calls NBC's Bakong Open API. Only the endpoints Motify needs are wrapped. */
export class BakongClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: BakongClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** Looks up the payment for a dynamic KHQR by the MD5 of its QR string. */
  async checkTransactionByMd5(md5: string): Promise<TransactionLookup> {
    const envelope = await this.post<BakongTransaction>('/v1/check_transaction_by_md5', { md5 });
    if (envelope.responseCode === 0 && envelope.data) return { status: 'PAID', transaction: envelope.data };
    if (envelope.errorCode === TRANSACTION_NOT_FOUND) return { status: 'NOT_FOUND' };
    if (envelope.errorCode === TRANSACTION_FAILED) return { status: 'FAILED' };
    throw new BakongApiError(envelope.responseMessage ?? 'Bakong rejected the transaction lookup.', 200, envelope.errorCode ?? null);
  }

  private async post<T>(path: string, body: unknown): Promise<BakongEnvelope<T>> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new BakongApiError(`Bakong request failed: ${error instanceof Error ? error.message : String(error)}`, null);
    }
    if (!response.ok) {
      throw new BakongApiError(describeHttpFailure(response.status), response.status);
    }
    try {
      return await response.json() as BakongEnvelope<T>;
    } catch {
      throw new BakongApiError('Bakong returned a response that is not JSON.', response.status);
    }
  }
}

function describeHttpFailure(status: number) {
  if (status === 401) return 'Bakong rejected the access token (HTTP 401). Renew BAKONG_TOKEN.';
  if (status === 403) return 'Bakong refused the request (HTTP 403). Production calls must come from an IP in Cambodia.';
  if (status === 429) return 'Bakong rate limit reached (HTTP 429).';
  return `Bakong request failed with HTTP ${status}.`;
}

/** Reads the `exp` claim of a Bakong access token (a JWT). Returns null when the token carries none. */
export function bakongTokenExpiry(token: string): Date | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : null;
  } catch {
    return null;
  }
}
