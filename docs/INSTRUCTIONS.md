# ObsidianDesk — Implementation Roadmap

6-недельный план. Каждая неделя = goal, deliverables, acceptance criteria, known unknowns.

## Prerequisites (Week 0 — до старта)

**Установить:**
- Rust 1.93+ (stable toolchain, `rustup update stable`), Solana CLI latest (Agave — `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`), Anchor (0.31+)
- Node.js 24+ (LTS-линия), pnpm 9+
- Bitcoin Core testnet / signet wallet
- Claude Code или Cursor
- Аккаунты: GitHub (private repo), Solana devnet keypair, Bitcoin signet keypair

**Прочитать pre-alpha docs:**
- `docs.ika.xyz` → Solana integration guide (dWallet lifecycle, policy API)
- `docs.encrypt.xyz` → FHE types, client SDK, on-chain primitives
- Сохранить оба в `/docs/vendor/` репозитория как reference для AI-промптов

**Создать структуру репо:**
```
obsidian-desk/
├── programs/obsidian-core/       # Anchor program
├── app/                          # Next.js frontend
├── sdk/                          # shared TS SDK
├── keeper/                       # matching keeper bot
├── scripts/                      # deploy + test scripts
├── docs/                         # vendor docs, design docs
└── tests/                        # integration tests
```

---

## Week 1 — Foundations

**Goal:** Каркас всего + happy-path без FHE/dWallet, просто чтобы показать поток данных.

**Deliverables:**
1. Anchor program со stub-инструкциями (submit_order, cancel, try_match, settle) — работают с plaintext данными, без FHE.
2. Next.js app с routing: `/`, `/trade`, `/deposit`, `/positions`, `/about`
3. Дизайн-токены (palette, typography) из `UI_DESIGN.md` зашиты в Tailwind config
4. Базовая навигация + кошелёк-коннект (Phantom + Backpack)
5. Placeholder для encryption/dwallet API — thin adapter interface в `sdk/src/encrypt.ts`, `sdk/src/ika.ts`

**Acceptance:**
- Можно подключить кошелёк, увидеть 3 страницы.
- Можно сабмитить plaintext-ордер в Anchor program на devnet, увидеть его в `/positions`.
- Тёмная тема, навигация работает, шрифты правильные.

**Known unknowns:**
- Какие именно npm-пакеты для Encrypt SDK / Ika SDK. → Прочитать pre-alpha docs в day 1, зафиксировать в README.

**Used prompts:** P1 (scaffold), P5 (Next.js app scaffold + design system)

---

## Week 2 — Encrypt integration (FHE layer)

**Goal:** Ордер зашифрован клиентом, хранится как ciphertext на Solana, простейший FHE-compare работает.

**Deliverables:**
1. `sdk/src/encrypt.ts` обёртка над Encrypt SDK: `encryptOrder(plain) → ciphertexts[]`, `decryptReveal(ct) → plain` (через threshold network)
2. Anchor program: EncryptedOrder account layout, serde для ciphertext-bytes
3. CPI в Encrypt on-chain program для `enc_gte`, `enc_min`, `enc_xor` (или aналог, зависит от API)
4. `try_match` реализован: принимает 2 ордера, возвращает ciphertext `can_match`
5. Integration test: два ордера с пересекающимися ценами, `can_match` decrypts to 1

**Acceptance:**
- В explorer'е Solana EncryptedOrder account содержит только шифр (визуально проверяется).
- Test passes: `A.buy@70k` + `B.sell@69k` → match=1; `A.buy@70k` + `B.sell@71k` → match=0.

**Known unknowns:**
- Размер FHE-ciphertext для u64 (может быть 10KB+, важно для account size и rent).
- Время выполнения enc_gte — если >2s, перенести matching off-chain.

**Used prompts:** P3 (Encrypt integration), updated P2 (program with FHE types)

---

## Week 3 — Ika dWallet integration

**Goal:** User может создать dWallet на BTC testnet, залочить политику, program может триггерить подпись.

**Deliverables:**
1. `sdk/src/ika.ts` обёртка: `createDWallet(chain="bitcoin") → {id, btcAddress}`, `lockPolicy(dwalletId, programPolicy)`, `requestSign(dwalletId, tx)`
2. UI `/deposit` page: step-by-step onboarding (Create dWallet → Fund via BTC testnet faucet → Lock to ObsidianDesk policy)
3. Anchor program: `request_settlement` instruction вызывает Ika через CPI или event
4. Keeper bot (Node.js): слушает `SettleReady` event, вызывает Ika-подпись, релеит BTC tx
5. Integration test: два тестовых трейдера, полный E2E без FHE (с plaintext для скорости)

**Acceptance:**
- Testnet BTC реально перемещается между dWallet-адресами при триггере из Solana program.
- `/deposit` page показывает BTC-баланс dWallet после funding.

**Known unknowns:**
- Поддерживает ли Ika pre-alpha Solana → Bitcoin signing с сегодняшней policy-expressivity нужного уровня. Если нет → fallback на 1-of-1 simulated multisig с narrated explanation в демо-видео.

**Used prompts:** P4 (Ika dWallet integration)

---

## Week 4 — E2E integration + keeper + refinements

**Goal:** Full path: encrypted order → FHE match → dWallet settle → confirmed BTC tx.

**Deliverables:**
1. Keeper bot: цикл `try_match` по всем парам активных ордеров, затем `request_settlement` при match
2. Partial fill handling (optional, если успеваем): один ордер больше другого — остаток остаётся в book'е
3. Обработка edge-cases: cancelled orders, expired orders, double-match protection (program-level mutex)
4. SPV proof / oracle relay для подтверждения BTC-tx на Solana (можно упростить — trusted relay для MVP)
5. First full E2E test passing on devnet+signet

**Acceptance:**
- Запись скринкаста: 2 трейдера, encrypted order view, match, BTC на signet показывает реальную tx в block explorer, USDC в Solana explorer.

**Known unknowns:**
- Atomicity: honest-relay или нужно реальное BTC SPV-верификация? → MVP: trusted relay, задокументировать как known limitation.

**Used prompts:** P9 (integration + E2E)

---

## Week 5 — UI polish + wow-effect

**Goal:** Превратить работающий UI в что-то, что хочется смотреть в 4K. **Это главная неделя для выигрыша хакатона.**

**Deliverables (по приоритету):**
1. **Landing page wow hero** (см. UI_DESIGN.md §5): либо 3D вращающийся orderbook cube, либо 2D cipher-rain + live metrics widget. Pick one, polish.
2. **Trade page**: real-time orderbook wireframe с visual-cipher эффектом, order form с "encrypting..." анимацией submit'а, match toast с reveal-анимацией.
3. **Settlement widget**: split-screen Solana (фиолетовое свечение) + Bitcoin (оранжевое свечение) с пульсирующей связью между ними в момент settlement'а.
4. **Microcopy + empty states**: никаких "No data", всё должно быть в голосе бренда ("The book is silent. Good traders are patient.").
5. **Onboarding**: /deposit превращается в 3-шаговый wizard с анимацией каждого шага.

**Acceptance:**
- 3 sustained wow-моментов, которые можно выделить в видео как key frames.
- UI consistently темная, с одним акцентным цветом (cyan-teal), minimal clutter.
- Proper loading/error states везде.

**Used prompts:** P6 (landing wow), P7 (trade page), P8 (order submission flow)

---

## Week 6 — Demo, docs, submission

**Goal:** Submit в состоянии, где можно выигрывать.

**Deliverables:**
1. Demo video (4:30–4:50) — прицельно по `DEMO_SCRIPT.md`:
   - 0:00–0:30 problem & tagline
   - 0:30–1:30 UI tour (landing → deposit → trade)
   - 1:30–3:00 live E2E: 2 traders, encrypted order, match, native BTC settle
   - 3:00–4:00 why Ika+Encrypt are essential (side-by-side "remove Ika" / "remove Encrypt" = broken)
   - 4:00–4:50 team + roadmap + close
2. `README.md` в репо по submission requirements: problem, target users, how Ika+Encrypt are used, build/test/run instructions, deployed program IDs, frontend link
3. Deployment: app на Vercel, program на Solana devnet (+ Encrypt devnet + Ika devnet)
4. Pitch в брифе хакатона: короткий текст сопровождения submission
5. Back-up: README в режиме "если видео не загрузилось, вот live demo и screenshots"

**Acceptance:**
- Submission готов за 48 часов до дедлайна.
- 2 внешних человека прогнали demo — ничего не сломалось.

---

## Cut-list — что резать при отставании

Приоритет удаления (сверху вниз):

1. 3D hero → заменить на хороший 2D с framer-motion
2. Partial fills → полные fills only
3. SPV proof → trusted relay
4. Multi-market → только BTC/USDC
5. Keeper bot → ручной "Try match" button в UI (отлично для демо!)
6. Onboarding wizard → одна кнопка "Create dWallet"

**Никогда не резать:**
- FHE-сравнение в программе (это ядро концепта)
- Реальный BTC testnet tx (это ядро wow-момента)
- Dark UI polish (это то, что отличает 1-е место от 3-го)

---

## Чек-лист перед submission

- [ ] Program задеплоен на devnet, ID в README
- [ ] App задеплоен на Vercel, URL в README
- [ ] Demo video ≤5 min загружено
- [ ] README имеет все поля из брифа submission requirements
- [ ] GitHub repo public
- [ ] README объясняет *почему оба* протокола essential с конкретными примерами
- [ ] Screenshots в README (3+ штуки wow-моментов)
- [ ] В описании сделал акцент на **native BTC** и **no bridge**, **encrypted book** и **no leakage** — это differentiators
- [ ] Upload в hackathon submission form
