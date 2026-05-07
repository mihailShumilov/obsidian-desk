import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertNotMockOnMainnet, isMainnetEndpoint } from '../src/safety.ts';

describe('safety.isMainnetEndpoint', () => {
  it('matches mainnet hints', () => {
    assert.equal(isMainnetEndpoint('https://api.mainnet-beta.solana.com'), true);
    assert.equal(isMainnetEndpoint('mainnet'), true);
    assert.equal(isMainnetEndpoint('https://api.mainnet.solana.com'), true);
  });
  it('does not match devnet/testnet', () => {
    assert.equal(isMainnetEndpoint('https://api.devnet.solana.com'), false);
    assert.equal(isMainnetEndpoint('http://127.0.0.1:18899'), false);
    assert.equal(isMainnetEndpoint(undefined), false);
  });
});

describe('safety.assertNotMockOnMainnet', () => {
  it('throws on mainnet + mock encrypt', () => {
    assert.throws(
      () => assertNotMockOnMainnet({
        rpc: 'https://api.mainnet-beta.solana.com',
        encryptMode: 'mock',
        ikaMode: 'real',
      }),
      /safety guard/,
    );
  });

  it('throws on mainnet + auto mode (auto can fall back to mock)', () => {
    assert.throws(
      () => assertNotMockOnMainnet({
        rpc: 'https://api.mainnet-beta.solana.com',
        encryptMode: 'auto',
        ikaMode: 'auto',
      }),
      /can fall back to mock/,
    );
  });

  it('throws on mainnet + unset (defaults to risky)', () => {
    assert.throws(
      () => assertNotMockOnMainnet({
        rpc: 'https://api.mainnet-beta.solana.com',
      }),
      /safety guard/,
    );
  });

  it('passes on mainnet + both modes real', () => {
    assertNotMockOnMainnet({
      rpc: 'https://api.mainnet-beta.solana.com',
      encryptMode: 'real',
      ikaMode: 'real',
    });
  });

  it('passes on devnet regardless of mode', () => {
    assertNotMockOnMainnet({
      rpc: 'https://api.devnet.solana.com',
      encryptMode: 'mock',
      ikaMode: 'mock',
    });
    assertNotMockOnMainnet({
      rpc: 'https://api.devnet.solana.com',
      encryptMode: 'auto',
      ikaMode: 'auto',
    });
  });
});
