export class NotImplementedError extends Error {
  constructor(api: string) {
    super(`${api} is a P1 scaffold stub — wired in P3 (Encrypt) / P4 (Ika).`);
    this.name = 'NotImplementedError';
  }
}

export class EncryptionError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EncryptionError';
    this.cause = cause;
  }
}

export class DecryptionError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DecryptionError';
    this.cause = cause;
  }
}

export class VendorSDKUnavailableError extends Error {
  constructor(vendor: 'encrypt' | 'ika', detail?: string) {
    super(`${vendor} SDK unavailable${detail ? `: ${detail}` : ''}`);
    this.name = 'VendorSDKUnavailableError';
  }
}
