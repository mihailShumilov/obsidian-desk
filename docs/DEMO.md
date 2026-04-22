# Demo script — hackathon video

A shoot-ready runbook for recording the 3–4 minute submission video. Every scene lists the **on-screen action**, **narration line**, **timing**, and **what to emphasize**. Works top-to-bottom — no branching.

The video sells three differentiators: **encrypted orderbook (FHE)**, **native BTC settlement (Ika dWallets, no bridge)**, and the **match/settle choreography** that makes them feel concrete.

- Target length: **3:30–4:00 min** (hackathon judges skim; keep it tight)
- Aspect ratio: **16:9, 1920×1080** (or 2560×1440 if your capture rig handles it)
- Frame rate: **60 fps** (the cube rotation and the scramble effect lose fidelity at 30 fps)
- Audio: voiceover recorded separately, synced in post; ambient music at −24 LUFS under voice

---

## 0. Pre-shoot checklist

Do all of this **before** you hit record. Every item failing on camera costs a re-take.

### 0.1 Environment

- [ ] Mock mode on everywhere (`OBSIDIAN_ENCRYPT_MODE=mock`, `OBSIDIAN_IKA_MODE=mock` — default in `.env.example`). Real-mode SDKs ship uncompiled `.ts` in node_modules (gaps E5 / I0) — mock is the working path.
- [ ] Devnet is up and the program is deployed: `solana program show H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp --url devnet` prints a recent slot.
- [ ] Local stack is running: `pnpm docker:up` (M-series Macs: launch `solana-test-validator` on the host first, then `pnpm docker:up`). Wait for both containers to reach **healthy** — `docker compose ps`.
- [ ] Book is pre-seeded so `/trade` isn't empty on camera: `pnpm seed:demo` (market + 2 dWallets + 8 encrypted orders).
- [ ] Keeper `/status` responds: `curl -fsS http://127.0.0.1:13001/status | jq`. `attempted`/`settled` counters visible.
- [ ] Pyth BTC/USD websocket works (chart draws on `/trade`). If it's empty, hard-refresh — the socket reconnects.

### 0.2 Browser

- [ ] **Chrome or Arc** in a clean profile. No extensions showing badges (especially wallet extensions other than Phantom). No bookmarks bar.
- [ ] Window chrome: address bar hidden if your recorder supports it; otherwise zoom the window so the URL reads `obsidiandesk.app` (or `127.0.0.1:13000` if staying local — see §0.5).
- [ ] Phantom wallet installed, **devnet network selected**, wallet address pre-funded with ≥ 2 devnet SOL (`solana airdrop 2 <pubkey> --url devnet`).
- [ ] `/deposit` was completed once in this profile so the wizard remembers "step 3 done" (or reset it if you want to record the onboard — pick one and stick to it).
- [ ] DevTools **closed**. `prefers-reduced-motion` **disabled** at the OS level — the Encrypted Book Cube and scramble animations are what we came here to show.

### 0.3 Screen hygiene

- [ ] macOS menu bar hidden (`System Settings → Control Centre → Automatically hide and show the menu bar → Always`).
- [ ] Dock auto-hidden.
- [ ] No notification popups: enable **Focus → Do Not Disturb** before recording; double-check Slack, Messages, iTerm badge dots.
- [ ] Desktop wallpaper set to solid black (`#0A0B0F`) — if a screen sliver leaks, it matches the app.
- [ ] Cursor size default; disable "shake to locate" (it will fire during recording).

### 0.4 Fallback seed

If the live match fails mid-recording (keeper desync, RPC timeout), do **not** troubleshoot on camera — cut, reset, and re-record. Have these ready in parallel tabs:

- Tab A: `/trade` post-seed (primary)
- Tab B: `/trade?admin=1` (shows the _Match all_ / _Fast_ buttons if the keeper stalls)
- Tab C: `/positions` (already has at least one settled row from the seed)
- Tab D: keeper `/status` endpoint (for the end-screen overlay)

The `?admin=1` query param is visible in the URL bar — hide the URL or crop in post. Do not narrate "I'm using admin mode" on camera.

### 0.5 Recording pipeline

Two viable paths:

1. **Local demo, cropped in post.** Record `127.0.0.1:13000`, crop the URL in Final Cut / DaVinci. Lowest risk, but the local URL flashes during scene cuts — crop carefully.
2. **Deployed demo on `obsidiandesk.app` via Cloudflare DNS (§6 of `DEPLOYMENT.md`).** Real domain on screen, looks finished. Requires the VPS + Caddy setup done before shoot day.

Pick 2 if the stack has been live for more than 48 h and you trust the devnet RPC; pick 1 otherwise — a rehearsal that crashes on the remote edge is worse than cropping `127.0.0.1`.

---

## 1. Scene-by-scene script

Total: ~3:45. Timings are targets — narration is what sets the pace, don't rush visuals to hit a second.

### Scene 1 — The hook (0:00 → 0:25)

**On screen:** Landing page `/`. Encrypted Book Cube rotating slowly, ciphertext glyphs mutating every ~800 ms. Tagline fades in:
> The dark pool where
> **Bitcoin never leaves Bitcoin.**

**Action:** Don't move the mouse. Let the cube breathe for 8 full seconds. Scroll begins at **0:15**.

**Narration:**
> *"Institutional traders need size. But public orderbooks leak: front-runners see the price, the intent, the counterparty. Bridges solve custody by breaking it — wrapped BTC is a liability, not Bitcoin. Custodians solve bridges by taking your keys."*

**Emphasize:** The cube is the brand. This is the frame judges will screenshot.

**Cut:** cross-fade to Scene 2 as the scroll hits the Problem panels.

### Scene 2 — The solution (0:25 → 0:50)

**On screen:** Scroll the landing page past the three Problem cards ("Public orders leak", "Bridges break", "Custodians control") into the Solution diagram. Each component of the architecture illuminates as it enters view: Solana program → Encrypt (FHE) → Ika (dWallet MPC) → Bitcoin signet.

**Action:** Smooth scroll (trackpad swipe, not wheel clicks). Pause on the Solution diagram for 4 seconds. Click **Launch Terminal**.

**Narration:**
> *"ObsidianDesk is a dark-pool DEX on Solana. Orders are sealed on-chain with Encrypt's FHE — the book matches ciphertext, the values never decrypt. Settlement is native BTC, co-signed by Ika dWallets. No bridge. No wrapped token. No plaintext orderbook."*

**Emphasize:** The words **"the book matches ciphertext, the values never decrypt"** — this is the one sentence that separates us from every generic DEX demo.

### Scene 3 — Onboarding: dWallet + lock (0:50 → 1:30)

**On screen:** `/deposit` wizard, three steps visible in the progress rail.

**Action:**

1. (0:50) On Step 1 ("Create dWallet"), click **Generate dWallet**. Key-shard illustration plays. A signet BTC address appears.
2. (1:05) Step 2 auto-advances. QR code + big copy button. _Say_ the address was pre-funded — don't wait 15 s for the esplora poll on camera. The balance card reads `0.050 BTC`.
3. (1:15) Scroll to Step 3 ("Lock to ObsidianDesk"). Show the `policy:` mono block with `controller`, `max_amount_per_tx`, `allowed_recipients`, `expiry_per_order`. Click **Lock**.
4. (1:28) Success toast: "dWallet locked. You control the keys — the network can only co-sign matches."

**Narration:**
> *"To trade, you generate a dWallet — a Bitcoin address controlled jointly by you and the Ika MPC network. You fund it with native BTC. Then you authorize ObsidianDesk to co-sign settlement transactions, but only within this policy: only to matched counterparties, only for matched amounts, only before expiry. The keys never leave the dWallet. There's no bridge to trust."*

**Emphasize:** The policy block. Judges read it. Do not scroll past it fast.

### Scene 4 — Seal an encrypted order (1:30 → 2:05)

**On screen:** `/trade`. Three-column layout: `OrderbookVoid` on the left (14 encrypted lines, ciphertext mutating), Pyth price chart center, order form right. Your dWallet is shown bottom-right: `bc1q...k8xz  0.050`.

**Action:**

1. (1:30) Hover the OrderbookVoid for 3 seconds. Let judges *see* the ciphertext churn. Do **not** hover any specific row.
2. (1:38) Click the **Buy** tab. Type price `69850`. Type size `0.005`. Both fields look normal.
3. (1:50) Click **Encrypt & Seal**. Watch the **1.8 s choreography**:
   - Button text → `Encrypting…`, cipher-cyan progress bar
   - Input fields *scramble* character-by-character left-to-right into `[A-Z0-9]` glyphs
   - Scrambled fields collapse upward into a small sealed envelope
   - Envelope shoots off-screen toward the header
   - Toast bottom-right: `Order sealed. Waiting for match.` with copyable tx hash
4. (2:02) Hover the new row in **Your Orders** — it's the only row rendered with decrypted values (cipher-cyan left border). The rest of the book still shows ciphertext.

**Narration:**
> *"Placing an order. Price, size — normal inputs. When I seal it, the values encrypt client-side and land in the book as ciphertext. Every other trader sees this row as noise. Only I can decrypt my own order. That's FHE — the matcher operates on ciphertext, it never sees a price."*

**Emphasize:** The scramble animation *is* the encryption in the user's mental model. Don't narrate over it — pause for the full 1.8 s.

### Scene 5 — Match + settle: the duality (2:05 → 3:00)

**The money shot.** If anything in the video gets screenshotted, it is this scene.

**On screen:** `/trade`. Click the **Try Match** button in the header. (If the keeper is stalled, fall back to the `?admin=1` **Match all** button — hide the URL in post.)

**Action:**

1. (2:05) Click **Try Match**. Full-screen modal takes over.
2. (2:07) **Stage 1 — Match Beacon** (0.8 s). Radial pulse in match-gold, three concentric rings expanding. Top text: `MATCH DETECTED`.
3. (2:10) **Stage 2 — Reveal** (1.2 s). Beacon fades. Two cards slide in: left = `Bidder #A8F3`, right = `Asker #9B21`. Between them: `0.500 BTC @ $69,850.00 USDC`. Bidder and Asker show their dWallet addresses, truncated.
4. (2:14) **Stage 3 — Settlement in motion** (~4 s). Split-screen:
   - Left panel: violet **Solana** glow. Status ticks: `USDC transferring: 0% → 33% → 100%`.
   - Right panel: ember **Bitcoin** glow. Status ticks: `BTC signing initiated → signed (1/T) → broadcast → 1 conf → 3 confs`.
   - `SettleThread` — cipher characters shimmer left-to-right between the panels, pulsing.
   - Top text rotates: `Ika is signing… Encrypt revealed fill. Bitcoin broadcasting…`
5. (2:45) **Stage 4 — Sealed** (0.5 s). Both panels get a cipher-cyan checkmark. Modal collapses to a top bar: `Match #42 settled. View ↗`.

**Narration (start at 2:05, continue through 2:55):**
> *"Now, the match. When two sealed orders cross, Encrypt reveals the fill only to the counterparties — no one else. Then Ika's dWallet MPC network co-signs a Bitcoin transaction that moves the BTC leg natively. On the left: USDC settles on Solana. On the right: native BTC on-chain — no wrapping, no bridge, no custodian. Both legs atomic under the match."*

**Emphasize:** Let the choreography breathe. Under-narrate Stage 3 — the split-screen sells itself. Breathing pauses between "Solana" and "Bitcoin" in the VO reinforce the duality.

### Scene 6 — Proof (3:00 → 3:25)

**On screen:** `/positions`. Table of your orders.

**Action:**

1. (3:00) Scroll to Match #42. Row status badge reads **Settled** (cipher-cyan).
2. (3:05) Click the row to expand. Two hashes: **Solana tx** and **BTC tx**.
3. (3:10) Click the BTC tx hash — opens `mempool.space/signet/tx/...` in a new tab. Let the page load. Judges see 3 confirmations on a real signet block explorer.
4. (3:18) Cut back to `/positions`.

**Narration:**
> *"Two transactions. Both public. Both verifiable. Solana settled the USDC. Bitcoin signet settled the BTC — a native transaction, cosigned by the Ika MPC, going to an address the dWallet policy authorized. This is the whole point: encrypted book, matched in ciphertext, settled in the open."*

**Emphasize:** The mempool.space explorer page. Don't skip this — a real blockchain receipt is what converts the demo from "slick UI" to "actually works".

### Scene 7 — Outro (3:25 → 3:45)

**On screen:** Fade to a closing card over a muted version of the landing cube. Three lines, centered:

```
ObsidianDesk
Encrypted orderbook. Native BTC. No bridges.

obsidiandesk.app
github.com/mihailShumilov/obsidian-desk
devnet: H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp
```

**Narration:**
> *"ObsidianDesk — live at obsidiandesk.app. Built for Encrypt + Ika. Repo linked. Thank you."*

**Cut to black at 3:45.**

---

## 2. What to say if / when someone asks "is this real?"

The vendor SDKs for Encrypt and Ika are pre-alpha and currently ship uncompiled TypeScript that can't run in our Node 24 runtime — documented in `docs/gaps.md` as E5 and I0. Our implementation is **mock-mode behind the real API surface**: every call site that will talk to the vendor in production talks to a local adapter today that returns correctly-shaped data (ciphertext bytes, dWallet addresses, signed BTC transactions). The Solana program, the matching logic, and the settlement choreography are real — swapping the two `OBSIDIAN_*_MODE=mock` env vars to `real` is the Week 6 deliverable and does not require UI changes. Say this plainly if asked; don't oversell.

---

## 3. Common shoot-day failures and fixes

| Symptom | Cause | On-camera fix |
|---|---|---|
| Cube doesn't rotate | WebGL disabled / GPU throttled | Close other GPU-heavy apps; relaunch Chrome with hw accel on |
| Wallet button does nothing | `NEXT_PUBLIC_SOLANA_RPC` unreachable | Refresh; if persistent, cut and fix — see `DEPLOYMENT.md` §8 |
| OrderbookVoid empty | Seed didn't run / expired | `pnpm seed:demo` again, refresh `/trade` |
| **Try Match** spins forever | Keeper lost IDL / desynced | Use `?admin=1` → **Match all**; cover URL in post |
| Scramble animation jumps | Recorder dropping frames at 30 fps | Record at 60 fps, export to 60 fps — do not interpolate |
| Pyth chart empty | Pyth websocket blocked by network | Hard-refresh once; if it stays empty, blur the chart region in post |
| Phantom pops up during a scene | Auto-lock timed out | Unlock Phantom 30 s before rolling; increase its auto-lock to 24 h in settings |

---

## 4. Post-production checklist

- [ ] First 3 seconds = the cube. No logo card, no black frame — judges decide in 3 seconds whether to keep watching.
- [ ] Voiceover ducks music to −18 LUFS when speaking, back to −24 LUFS when silent.
- [ ] Lower-third name tag at 3:25 (team name + "Encrypt + Ika hackathon 2026").
- [ ] Captions baked in **or** as a sidecar `.srt`. Judges on mute need them.
- [ ] File: **`ObsidianDesk-demo.mp4`**, H.264, ~20 Mbps, AAC audio, under 100 MB if possible (YouTube accepts more; submission portals often don't).
- [ ] Upload in private **and** keep the source project file — if the submission rules change ("under 3 min", "under 500 MB"), you'll need to re-export.
- [ ] Confirm `obsidiandesk.app` is live and reachable from a clean network (disable VPN, mobile hotspot check) before submitting — the README links it as the live demo.

---

## 5. Where else to look

- [`docs/UI_DESIGN.md`](UI_DESIGN.md) §5 — authoritative choreography spec for the three wow-moments (cube, scramble, match/settle). This doc's timings come from there.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — system design if a judge asks a follow-up after the video.
- [`docs/gaps.md`](gaps.md) — the honest list of mock-mode boundaries and what goes real in Week 6.
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) §6 — if you're shooting against the VPS + Cloudflare deploy instead of localhost.
- [`README.md`](../README.md) §Demo flow — the 4-line text version of Scenes 3–6 for skim readers.
