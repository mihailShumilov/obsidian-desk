import { NotImplementedError } from './errors.js';

export type Side = 'bid' | 'ask';

export interface EncryptedOrderBlob {
  side_ct: Uint8Array;
  price_ct: Uint8Array;
  size_ct: Uint8Array;
  nonce: Uint8Array;
}

export async function encryptSide(_side: Side): Promise<Uint8Array> {
  throw new NotImplementedError('encrypt.encryptSide');
}

export async function encryptU64(_value: bigint): Promise<Uint8Array> {
  throw new NotImplementedError('encrypt.encryptU64');
}

export async function encryptOrder(
  _side: Side,
  _priceQuote: bigint,
  _sizeBase: bigint,
): Promise<EncryptedOrderBlob> {
  throw new NotImplementedError('encrypt.encryptOrder');
}

export async function requestThresholdDecrypt(
  _ciphertext: Uint8Array,
  _txSignature: string,
): Promise<bigint> {
  throw new NotImplementedError('encrypt.requestThresholdDecrypt');
}
