/**
 * Crockford-style alphabet for ciphertext-feeling visuals.
 *
 * Used by Cipher / CipherField / BookCube3D / OrderForm scramble. Single
 * source so a future "drop the digits" tweak doesn't desync surfaces.
 */

export const CIPHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

export function randomCipherChar(): string {
  return CIPHER_ALPHABET[Math.floor(Math.random() * CIPHER_ALPHABET.length)]!;
}

export function randomCipherString(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += randomCipherChar();
  }
  return out;
}
