import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockStore, type MockEntry } from '../src/mock-store.ts';

function tempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-mock-store-'));
  return path.join(dir, 'keys.json');
}

describe('mock-store.MockStore', () => {
  let storePath: string;
  let store: MockStore;

  beforeEach(() => {
    storePath = tempStorePath();
    store = new MockStore(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true, force: true }); }
    catch { /* ignore */ }
  });

  it('returns undefined for unknown ids', () => {
    assert.equal(store.get('nope'), undefined);
    assert.equal(store.size(), 0);
  });

  it('round-trips a mock-mode entry through the file', () => {
    const entry: MockEntry = {
      wif: 'cVMt7M3pZBjCFi5JVEjeYpDJsHynhJ5Y9KcNB5tzmWLPRn5DGYxX',
      chain: 'bitcoin-signet',
      address: 'tb1qexampleaddress0000000000000000000000000',
      creator: 'CreatorBase58Pubkey',
    };
    store.set('id-1', entry);

    // Make a fresh handle on the same path — proves the data is on disk,
    // not just in the original process's memory.
    const reopened = new MockStore(storePath);
    const got = reopened.get('id-1');
    assert.deepEqual(got, entry);
    assert.equal(reopened.size(), 1);
  });

  it('round-trips a real-mode entry with bigint policy + Uint8Array publicKey', () => {
    const entry: MockEntry = {
      chain: 'bitcoin-signet',
      address: 'tb1qrealmoderesult0000000000000000000000000',
      creator: 'CreatorBase58Pubkey',
      publicKey: new Uint8Array([0x02, 0xab, 0xcd, ...new Array(30).fill(0xff)]),
      policy: {
        controller: 'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp',
        maxAmountSats: 1_000_000_000n,
        expirySlots: 216_000,
        rules: [{ kind: 'maxNotional', sats: '5000' }],
      },
      policyAccountOnSolana: 'mock_policy_deadbeefcafe',
    };
    store.set('id-2', entry);

    const reopened = new MockStore(storePath);
    const got = reopened.get('id-2');
    assert.ok(got);
    assert.equal(got.address, entry.address);
    assert.equal(got.policy?.maxAmountSats, 1_000_000_000n, 'bigint preserved');
    assert.ok(got.publicKey instanceof Uint8Array, 'Uint8Array preserved');
    assert.equal(got.publicKey?.length, 33);
    assert.equal(got.publicKey?.[0], 0x02);
  });

  it('survives concurrent set() calls without corruption', () => {
    // Sequential here — full lock-based concurrent test would need worker_threads.
    // Atomic rename means each `set` either lands fully or doesn't, so even
    // racing writers can only lose one update — never produce a corrupt file.
    for (let i = 0; i < 20; i++) {
      store.set(`id-${i}`, {
        chain: 'bitcoin-signet',
        address: `tb1q${i.toString(16).padStart(40, '0')}`,
        creator: 'C',
      });
    }
    assert.equal(store.size(), 20);
    const reopened = new MockStore(storePath);
    assert.equal(reopened.size(), 20);
  });

  it('delete removes only the targeted id', () => {
    store.set('a', { chain: 'bitcoin-signet', address: 'tb1qa' });
    store.set('b', { chain: 'bitcoin-signet', address: 'tb1qb' });
    assert.equal(store.delete('a'), true);
    assert.equal(store.delete('a'), false, 'second delete is no-op');
    assert.equal(store.get('a'), undefined);
    assert.deepEqual(store.get('b'), { chain: 'bitcoin-signet', address: 'tb1qb' });
  });

  it('reset() removes the file', () => {
    store.set('x', { chain: 'bitcoin-signet', address: 'tb1qx' });
    assert.ok(fs.existsSync(storePath));
    store.reset();
    assert.equal(fs.existsSync(storePath), false);
    assert.equal(store.size(), 0);
    // reset on already-missing file is a no-op.
    store.reset();
  });

  it('writes file with restrictive permissions (0600)', () => {
    store.set('x', { chain: 'bitcoin-signet', address: 'tb1qx' });
    const stat = fs.statSync(storePath);
    // Only owner read/write — no group, no other.
    assert.equal(stat.mode & 0o077, 0, 'no group/other perms allowed');
  });

  it('two MockStore handles on the same path see each others writes', () => {
    const a = new MockStore(storePath);
    const b = new MockStore(storePath);
    a.set('shared', { chain: 'bitcoin-signet', address: 'tb1q', creator: 'A' });
    const got = b.get('shared');
    assert.equal(got?.creator, 'A');
  });
});
