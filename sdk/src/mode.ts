/**
 * Tri-state mode resolver and auto-fallback wrapper.
 *
 * Every real-mode integration point (Encrypt, Ika, Bitcoin signet) routes its
 * dispatch through `tryReal()` so the same try-real-then-fallback semantics
 * apply uniformly:
 *
 *   - `mock`  — never call real, run mock directly.
 *   - `real`  — only call real; throw on any failure (no fallback).
 *   - `auto`  — call real with an 8s timeout; on transient/network failure
 *               run mock; on logical failure (validation, policy, HTTP 4xx)
 *               re-throw without falling back.
 *
 * `auto` is the default — the demo wants real interactions when the pre-alpha
 * networks are up and graceful degradation when they aren't.
 *
 * Each call returns a structured `ModeResult<T>` so the UI and logs can show
 * exactly which path was taken without re-deriving it.
 */

export type Mode = 'mock' | 'real' | 'auto';
export type Surface = 'encrypt' | 'ika' | 'btc';
/** What `tryReal` *returns*. `real-failed` is logged-only — when the real
 *  path fails terminally `tryReal` throws, so it never surfaces here. */
export type ResolvedMode = 'real-ok' | 'real-failed-fallback' | 'mock';
/** What the logger callback may receive. Adds `real-failed` for the two
 *  throw branches (force-real failure, auto-mode logical-error) so
 *  monitoring can distinguish failures from successes. */
export type LoggedMode = ResolvedMode | 'real-failed';

export interface ModeResult<T> {
  /** Operation return value. */
  value: T;
  /** Which path actually produced the value. */
  mode: ResolvedMode;
  /** Wall-clock ms the real attempt took (0 if mock was forced). */
  latencyMs: number;
  /** Failure reason if `mode === 'real-failed-fallback'`. */
  fallbackReason?: string;
}

const DEFAULT_REAL_TIMEOUT_MS = 8_000;

/**
 * Resolve the mode for `surface` from the appropriate env var.
 * Defaults to `auto` if the env var is unset or unrecognised.
 */
export function resolveMode(surface: Surface, env: NodeJS.ProcessEnv = process.env): Mode {
  const key =
    surface === 'encrypt' ? 'OBSIDIAN_ENCRYPT_MODE'
    : surface === 'ika' ? 'OBSIDIAN_IKA_MODE'
    : 'OBSIDIAN_BTC_MODE';
  const raw = env[key]?.toLowerCase();
  if (raw === 'mock' || raw === 'real' || raw === 'auto') return raw;
  return 'auto';
}

/**
 * Pluggable logger so callers (Next server actions, keeper daemon, tests)
 * can pipe structured fallback events into their own observability surface.
 * Default writes a single-line JSON to stderr.
 */
export interface ModeLogger {
  (event: {
    surface: Surface;
    op: string;
    mode: LoggedMode;
    latencyMs: number;
    fallbackReason?: string;
  }): void;
}

let activeLogger: ModeLogger = (event) => {
  // Single-line JSON keeps grep/jq pipelines clean.
  // Mock-only calls log too — quiet but useful when triaging "why is this
  // demo flow not hitting real?". Drop the level to debug if it gets noisy.
  const line = JSON.stringify({ t: new Date().toISOString(), ...event });
  process.stderr.write(`[obsidian-mode] ${line}\n`);
};

export function setModeLogger(logger: ModeLogger): void {
  activeLogger = logger;
}

/**
 * Predicate: is `err` the kind of failure that should trigger fallback in
 * `auto` mode? Network/transport errors yes; logical errors no.
 *
 * The allow-list is conservative — only errors we positively recognise as
 * transient network failures fall through. Anything ambiguous re-throws so
 * we don't silently mask real bugs as "pre-alpha network down".
 */
export function isTransientError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 4) return false;
  const e = err as {
    name?: string;
    code?: string | number;
    message?: string;
    status?: number;
    cause?: unknown;
  };

  // AbortSignal.timeout fires this name.
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;

  // Node net/dns/socket codes.
  const code = typeof e.code === 'string' ? e.code : '';
  if (
    code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' || code === 'EAI_AGAIN' || code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' || code === 'EPIPE' || code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_SOCKET'
  ) return true;

  // gRPC status codes — UNAVAILABLE (14), DEADLINE_EXCEEDED (4),
  // INTERNAL (13), RESOURCE_EXHAUSTED (8) all indicate the upstream isn't
  // healthy enough to serve us, not that we sent it bad input.
  if (typeof e.code === 'number' && [4, 8, 13, 14].includes(e.code)) return true;

  // The known-bad upstream SDKs trip these at module-load.
  if (typeof e.message === 'string') {
    if (e.message.includes('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING')) return true;
    if (e.message.includes('ERR_MODULE_NOT_FOUND')) return true;
    // grpc-js bubbles up this string when the upstream resets the stream.
    if (e.message.includes('Stream removed')) return true;
    // Cloudflare / Caddy in front of esplora returns 503 sometimes.
    if (e.message.includes('503') || e.message.includes('502') || e.message.includes('504')) return true;
    // undici (node fetch impl) wraps every transport error in a top-level
    // TypeError("fetch failed") with the real reason in `.cause`.
    if (e.message === 'fetch failed') return true;
    // undici-specific transport phrases that surface when the peer is
    // unreachable, refusing, or a port is reserved/blocked.
    if (
      e.message.includes('bad port') ||
      e.message.includes('connect ECONNREFUSED') ||
      e.message.includes('Other side closed')
    ) return true;
  }

  // HTTP status from fetch wrappers — 5xx is transient, 4xx is logical.
  if (typeof e.status === 'number' && e.status >= 500 && e.status < 600) return true;

  // Walk the cause chain — fetch wraps the real network error one level deep.
  if (e.cause !== undefined) return isTransientError(e.cause, depth + 1);

  return false;
}

interface TryRealOptions<T> {
  surface: Surface;
  op: string;
  mode: Mode;
  /** Real-mode dispatch. Will be wrapped with `timeoutMs`. */
  real: (signal: AbortSignal) => Promise<T>;
  /** Mock-mode dispatch. Called when mode is `mock`, or as fallback. */
  mock: () => Promise<T>;
  /** Override the 8s default if the real call legitimately takes longer
   *  (e.g. an MPC presign round). Bound from above by 30s — anything longer
   *  is a code smell, not a network slowness issue. */
  timeoutMs?: number;
}

/**
 * Run an operation under the configured mode. Always returns; never bubbles
 * a transient failure to the caller in `auto` mode (mock fills in instead).
 *
 * Logical failures (validation, policy, malformed inputs) re-throw because
 * mocking won't fix them and silent fallback would mask real bugs.
 */
export async function tryReal<T>(opts: TryRealOptions<T>): Promise<ModeResult<T>> {
  const { surface, op, mode, real, mock } = opts;
  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_REAL_TIMEOUT_MS, 30_000);

  if (mode === 'mock') {
    const value = await mock();
    activeLogger({ surface, op, mode: 'mock', latencyMs: 0 });
    return { value, mode: 'mock', latencyMs: 0 };
  }

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`real-mode timeout after ${timeoutMs}ms`)), timeoutMs);

  try {
    const value = await real(ctrl.signal);
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    activeLogger({ surface, op, mode: 'real-ok', latencyMs });
    return { value, mode: 'real-ok', latencyMs };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const reason = err instanceof Error ? err.message : String(err);

    // Force-real: surface the failure to the caller. No fallback, no mocking.
    if (mode === 'real') {
      activeLogger({ surface, op, mode: 'real-failed', latencyMs, fallbackReason: `THROW: ${reason}` });
      throw err;
    }

    // Auto mode: fall back only on transient failures. Logical errors throw.
    if (!isTransientError(err)) {
      activeLogger({ surface, op, mode: 'real-failed', latencyMs, fallbackReason: `LOGICAL: ${reason}` });
      throw err;
    }

    const value = await mock();
    activeLogger({ surface, op, mode: 'real-failed-fallback', latencyMs, fallbackReason: reason });
    return { value, mode: 'real-failed-fallback', latencyMs, fallbackReason: reason };
  }
}

/**
 * Convenience: unwrap a ModeResult when the caller doesn't care about which
 * path produced the value (e.g. tests). Use sparingly — the demo UI wants
 * the mode marker.
 */
export function unwrap<T>(r: ModeResult<T>): T {
  return r.value;
}
