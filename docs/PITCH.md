# ObsidianDesk — 2-minute pitch script

> **Total runtime:** ~2:00 at conversational pace (~280 words).
> **Companion deck:** `/pitch` on the live site (`obsidiandesk.app/pitch`).
> **Stage convention:** scroll the deck once per slide. The deck is the product — the cipher cube, the orderbook, the duality diagram are all real components from the app, not slideware.

---

## Pacing map

| # | Slide        | Time   | Cumulative |
|---|--------------|--------|------------|
| 1 | Title        | 0:10   | 0:10       |
| 2 | Problem      | 0:25   | 0:35       |
| 3 | Thesis       | 0:15   | 0:50       |
| 4 | How it works | 0:30   | 1:20       |
| 5 | Duality      | 0:15   | 1:35       |
| 6 | Live today   | 0:15   | 1:50       |
| 7 | Why me       | 0:15   | 2:05       |
| 8 | Closing      | 0:05   | 2:10       |

Trim **Why me** to 10s if running long — every other section is load-bearing.

---

## Slide 1 — Title  *(0:10)*

**On screen:** rotating encrypted cube, tagline.

> "This is **ObsidianDesk** — the dark pool where Bitcoin never leaves Bitcoin. Encrypted orderbook on Solana. Native settlement on the Bitcoin chain. No bridges, no leakage."

*(Pause. Let the cube speak.)*

---

## Slide 2 — Problem  *(0:25)*

**On screen:** three cards — leaky orderbook, broken bridge, surveillance eye.

> "Bitcoin is the deepest collateral in the world, but trading it on chain costs you something every time.
>
> If you use a public DEX, your orderbook is plaintext — every quote and cancel is replayed against you in real time.
>
> If you use a wrapped token, you've handed BTC to a custodian and trusted a bridge that history says will eventually break.
>
> And if you use a centralized dark pool, you have privacy from peers, but the operator keeps a perfect record on you.
>
> All three options leak."

---

## Slide 3 — Thesis  *(0:15)*

**On screen:** ciphertext block scrolling-decrypts into a clean orderbook ladder.

> "ObsidianDesk fixes both halves at once. Match in the dark — under fully homomorphic encryption. Settle in native Bitcoin — with a real UTXO on the Bitcoin chain. The book stays sealed; only the fill is revealed."

---

## Slide 4 — How it works  *(0:30)*

**On screen:** three step-cards (Seal · Match · Settle), then the Solana ↔ Bitcoin shimmer thread.

> "Three steps.
>
> **One — Seal.** The trader encrypts price and size client-side using the Encrypt SDK. What lands on Solana is a 32-byte ciphertext reference. Plaintext never touches the chain.
>
> **Two — Match under FHE.** Our Solana program runs the matching graph as a homomorphic computation over Encrypt. Only the resulting fill — the two orders that crossed — is decrypted. The rest of the book stays sealed.
>
> **Three — Native settle.** Ika dWallets co-sign a real Bitcoin transaction against MPC validators. BTC moves on the BTC chain. No wrapper. No bridge. No custodian. One match, two chains, zero leakage."

---

## Slide 5 — Duality  *(0:15)*

**On screen:** two red-tinted broken diagrams.

> "Encrypt without Ika is half a system — you'd have a private book that has to settle through some custodian.
>
> Ika without Encrypt is half a system — you'd have native BTC settlement on top of a leaky public book.
>
> You need both. That's the whole bet."

---

## Slide 6 — Live today  *(0:15)*

**On screen:** four "Deployed / Live / Wired" cards with on-chain addresses.

> "This isn't a deck. The Solana program is deployed on devnet. The Encrypt program is deployed and the FHE matching graph runs against it. Ika dWallets are wired in real-mode against pre-alpha gRPC. End-to-end smoke tests pass — devnet today, signet for native BTC."

---

## Slide 7 — Why me  *(0:15)*

**On screen:** founder card + horizontal parallax timeline 2006 → 2026.

> "I'm Mykhailo Shumilov. Eighteen years building high-load, real-time systems — payment rails, SMS aggregators, video platforms, and a digital-asset exchange before. Currently CTO at Vadimages and co-founder of Trade Assistant. ObsidianDesk is exchange architecture, multi-chain settlement, and an encrypted matching engine — I've shipped every one of those layers before. Just never with FHE underneath."

---

## Slide 8 — Closing  *(0:05)*

**On screen:** "Trade Bitcoin in the dark. Settle Bitcoin on Bitcoin." + Launch Terminal CTA.

> "**Trade Bitcoin in the dark. Settle Bitcoin on Bitcoin.** Devnet is live now — try a sealed order, watch the UTXO move."

*(Hold on the closing line. End.)*

---

## Delivery notes

- **Voice:** terse, institutional, calm. No crypto-bro slang, no rocket emojis, no "gm". The tone is Bloomberg terminal, not Discord.
- **Pace:** ~135 words per minute. If you're at 1:45 by Slide 7, slow down — don't rush the closing.
- **Pauses:** silence on Slide 1 after "no bridges, no leakage" and on Slide 8 after the final line. The product looks expensive when you let it breathe.
- **Avoid:** technical jargon outside what's defined inline (FHE, dWallet, UTXO are okay because the slides show what they mean). Don't say "MPC", "PDA", or "BIP-322" out loud — those go in the docs.
- **Hands off the demo:** the deck animates itself. Don't gesture at the screen — let the parallax do the talking.

## Visual cue cheatsheet

| Beat                                       | Visual cue on screen                          |
|--------------------------------------------|-----------------------------------------------|
| "the dark pool where Bitcoin..."           | cube finishes one full rotation               |
| "all three options leak"                   | three problem cards lifted on hover           |
| "only the fill is revealed"                | ciphertext block resolves into ladder         |
| "one match, two chains, zero leakage"      | shimmer thread pulses Solana → Bitcoin        |
| "you need both"                            | both broken diagrams red-flash, then steady   |
| "end-to-end smoke tests pass"              | the four "Live / Deployed" cards land         |
| "I've shipped every one of those layers"   | timeline parallaxes 2006 → 2026               |
| "Settle Bitcoin on Bitcoin."               | hold on cipher-cyan headline                  |
