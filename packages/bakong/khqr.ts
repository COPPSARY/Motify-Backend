import { BakongKHQR, IndividualInfo, MerchantInfo, khqrData } from 'bakong-khqr';

export type KhqrCurrency = 'USD' | 'KHR';

export interface KhqrReceiver {
  /** Bakong account that receives the money, for example `motify@aclb`. */
  accountId: string;
  /** Shown in the payer's banking app. KHQR allows at most 25 characters. */
  merchantName: string;
  /** KHQR allows at most 15 characters. */
  merchantCity: string;
  /** Set both for a merchant account registered through a bank; omit both for an individual account. */
  merchantId?: string;
  acquiringBank?: string;
}

export interface KhqrPaymentRequest {
  /** Major units: dollars for USD, riel for KHR. */
  amount: number;
  currency: KhqrCurrency;
  /** Printed on the payer's receipt and tied to our payment row. At most 25 characters. */
  billNumber: string;
  expiresAt: Date;
  storeLabel?: string;
}

export interface Khqr {
  qr: string;
  /** Lower-case hex MD5 of `qr`; the key Bakong's check_transaction_by_md5 looks transactions up by. */
  md5: string;
}

export class KhqrGenerationError extends Error {
  constructor(message: string, readonly errorCode: number | null) {
    super(message);
    this.name = 'KhqrGenerationError';
  }
}

/** Builds a dynamic (single-amount, expiring) KHQR string. No network call is made. */
export function generateDynamicKhqr(receiver: KhqrReceiver, payment: KhqrPaymentRequest): Khqr {
  if (!(payment.amount > 0)) throw new KhqrGenerationError('A dynamic KHQR needs a positive amount.', null);
  const optional = {
    currency: payment.currency === 'USD' ? khqrData.currency.usd : khqrData.currency.khr,
    amount: payment.amount,
    billNumber: payment.billNumber,
    expirationTimestamp: payment.expiresAt.getTime(),
    ...(payment.storeLabel ? { storeLabel: payment.storeLabel } : {}),
  };
  const khqr = new BakongKHQR();
  const response = receiver.merchantId && receiver.acquiringBank
    ? khqr.generateMerchant(new MerchantInfo(
      receiver.accountId, receiver.merchantName, receiver.merchantCity, receiver.merchantId, receiver.acquiringBank, optional,
    ))
    : khqr.generateIndividual(new IndividualInfo(receiver.accountId, receiver.merchantName, receiver.merchantCity, optional));
  if (response.status.code !== 0 || !response.data) {
    throw new KhqrGenerationError(response.status.message ?? 'KHQR generation failed.', response.status.errorCode);
  }
  return { qr: response.data.qr, md5: response.data.md5 };
}
