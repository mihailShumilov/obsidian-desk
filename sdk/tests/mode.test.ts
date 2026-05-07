import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  isTransientError,
  resolveMode,
  setModeLogger,
  tryReal,
  type ModeLogger,
} from '../src/mode.ts';

function captureLogs() {
  const events: Parameters<ModeLogger>[0][] = [];
  setModeLogger((e) => events.push(e));
  return events;
}

describe('mode.resolveMode', () => {
  it('defaults to auto when env unset', () => {
    assert.equal(resolveMode('encrypt', {}), 'auto');
    assert.equal(resolveMode('ika', {}), 'auto');
    assert.equal(resolveMode('btc', {}), 'auto');
  });

  it('parses each tri-state value', () => {
    assert.equal(resolveMode('encrypt', { OBSIDIAN_ENCRYPT_MODE: 'mock' }), 'mock');
    assert.equal(resolveMode('encrypt', { OBSIDIAN_ENCRYPT_MODE: 'real' }), 'real');
    assert.equal(resolveMode('encrypt', { OBSIDIAN_ENCRYPT_MODE: 'auto' }), 'auto');
  });

  it('falls back to auto on unrecognised values', () => {
    assert.equal(resolveMode('ika', { OBSIDIAN_IKA_MODE: 'banana' }), 'auto');
    assert.equal(resolveMode('ika', { OBSIDIAN_IKA_MODE: '' }), 'auto');
  });

  it('is case-insensitive', () => {
    assert.equal(resolveMode('encrypt', { OBSIDIAN_ENCRYPT_MODE: 'MOCK' }), 'mock');
    assert.equal(resolveMode('encrypt', { OBSIDIAN_ENCRYPT_MODE: 'Real' }), 'real');
  });
});

describe('mode.isTransientError', () => {
  it('treats node net error codes as transient', () => {
    for (const code of [
      'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
      'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    ]) {
      assert.ok(isTransientError(Object.assign(new Error('net'), { code })), code);
    }
  });

  it('treats grpc UNAVAILABLE / DEADLINE_EXCEEDED as transient', () => {
    assert.ok(isTransientError(Object.assign(new Error('grpc'), { code: 14 })));
    assert.ok(isTransientError(Object.assign(new Error('grpc'), { code: 4 })));
    assert.ok(!isTransientError(Object.assign(new Error('grpc'), { code: 3 })));
  });

  it('treats AbortError / TimeoutError as transient', () => {
    const ab = new Error('aborted');
    ab.name = 'AbortError';
    assert.ok(isTransientError(ab));
    const to = new Error('t/o');
    to.name = 'TimeoutError';
    assert.ok(isTransientError(to));
  });

  it('treats vendor SDK module-load errors as transient (so fallback works)', () => {
    assert.ok(isTransientError(new Error('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')));
    assert.ok(isTransientError(new Error('ERR_MODULE_NOT_FOUND foo')));
  });

  it('treats 5xx http errors as transient, 4xx as logical', () => {
    assert.ok(isTransientError(Object.assign(new Error('h'), { status: 503 })));
    assert.ok(!isTransientError(Object.assign(new Error('h'), { status: 404 })));
  });

  it('treats plain validation errors as logical (not transient)', () => {
    assert.ok(!isTransientError(new Error('bad input')));
    assert.ok(!isTransientError(new TypeError('expected u64')));
  });
});

describe('mode.tryReal', () => {
  it('mock mode never invokes real', async () => {
    const events = captureLogs();
    let realCalled = 0;
    const r = await tryReal({
      surface: 'btc', op: 'broadcast', mode: 'mock',
      real: async () => { realCalled++; return 'real'; },
      mock: async () => 'mock',
    });
    assert.equal(realCalled, 0);
    assert.equal(r.value, 'mock');
    assert.equal(r.mode, 'mock');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.mode, 'mock');
  });

  it('real mode succeeds returns real-ok', async () => {
    captureLogs();
    const r = await tryReal({
      surface: 'btc', op: 'broadcast', mode: 'real',
      real: async () => 'broadcast-txid',
      mock: async () => { throw new Error('mock should not be called'); },
    });
    assert.equal(r.value, 'broadcast-txid');
    assert.equal(r.mode, 'real-ok');
    assert.ok(r.latencyMs >= 0);
  });

  it('real mode rethrows on failure (no fallback)', async () => {
    captureLogs();
    await assert.rejects(
      tryReal({
        surface: 'ika', op: 'sign', mode: 'real',
        real: async () => {
          const err: NodeJS.ErrnoException = new Error('upstream down');
          err.code = 'ECONNREFUSED';
          throw err;
        },
        mock: async () => 'should-not-be-called',
      }),
      /upstream down/,
    );
  });

  it('auto mode falls back on transient failure', async () => {
    const events = captureLogs();
    const r = await tryReal({
      surface: 'ika', op: 'createDWallet', mode: 'auto',
      real: async () => {
        const err: NodeJS.ErrnoException = new Error('refused');
        err.code = 'ECONNREFUSED';
        throw err;
      },
      mock: async () => 'mock-dwallet',
    });
    assert.equal(r.value, 'mock-dwallet');
    assert.equal(r.mode, 'real-failed-fallback');
    assert.match(r.fallbackReason ?? '', /refused/);
    assert.equal(events[0]!.mode, 'real-failed-fallback');
  });

  it('auto mode rethrows logical errors (does NOT fall back)', async () => {
    captureLogs();
    await assert.rejects(
      tryReal({
        surface: 'encrypt', op: 'encryptU64', mode: 'auto',
        real: async () => { throw new TypeError('expected bigint'); },
        mock: async () => 'should-not-be-called',
      }),
      /expected bigint/,
    );
  });

  it('auto mode honors the timeout and falls back', async () => {
    captureLogs();
    const r = await tryReal({
      surface: 'encrypt', op: 'createInput', mode: 'auto',
      timeoutMs: 50,
      real: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted by timeout');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      mock: async () => 'mock-after-timeout',
    });
    assert.equal(r.value, 'mock-after-timeout');
    assert.equal(r.mode, 'real-failed-fallback');
    assert.match(r.fallbackReason ?? '', /aborted/);
  });
});
