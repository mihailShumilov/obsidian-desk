/**
 * ObsidianDesk keeper bot — P1 scaffold.
 *
 * Real matching/settlement logic lands in P9. For now this is a heartbeat
 * loop so the workspace boots and the TS pipeline has something to compile.
 */

const POLL_INTERVAL_MS = 3_000;
const STATUS_PORT = Number(process.env['KEEPER_PORT'] ?? 13001);

type Tick = { iso: string; n: number };

async function pollOnce(state: Tick): Promise<void> {
  state.n += 1;
  state.iso = new Date().toISOString();
  console.log(`[keeper] tick #${state.n} @ ${state.iso}`);
}

async function main(): Promise<void> {
  console.log(`[keeper] start — polling every ${POLL_INTERVAL_MS}ms`);
  console.log(`[keeper] status endpoint will bind to port ${STATUS_PORT} (P9)`);
  const state: Tick = { iso: new Date().toISOString(), n: 0 };
  while (true) {
    try {
      await pollOnce(state);
    } catch (err) {
      console.error('[keeper] poll error', err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('[keeper] fatal', err);
  process.exit(1);
});
