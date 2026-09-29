// The subset of NBC's bakong-khqr SDK that Motify calls. The package ships no types.
declare module 'bakong-khqr' {
  export interface KhqrOptionalData {
    currency?: number;
    amount?: number;
    billNumber?: string;
    mobileNumber?: string;
    storeLabel?: string;
    terminalLabel?: string;
    purposeOfTransaction?: string;
    expirationTimestamp?: number;
    merchantCategoryCode?: string;
  }

  export interface KhqrResponse {
    status: { code: number; errorCode: number | null; message: string | null };
    data: { qr: string; md5: string } | null;
  }

  export class IndividualInfo {
    constructor(bakongAccountID: string, merchantName: string, merchantCity: string, optional?: KhqrOptionalData);
  }

  export class MerchantInfo extends IndividualInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      merchantID: string,
      acquiringBank: string,
      optional?: KhqrOptionalData,
    );
  }

  export class BakongKHQR {
    generateIndividual(info: IndividualInfo): KhqrResponse;
    generateMerchant(info: MerchantInfo): KhqrResponse;
    static verify(qr: string): { isValid: boolean };
    static decode(qr: string): KhqrResponse & { data: Record<string, unknown> | null };
  }

  export const khqrData: {
    currency: { usd: number; khr: number };
  };
}
