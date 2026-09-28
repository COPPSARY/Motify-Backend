# Motify Credits Plan

**File:** `credits.md`
**Goal:** Give every user a credit balance, then charge each AI generation in proportion to what it really costs, and give the credits back when the user got nothing.

Pricing numbers come from `Motify_Unit_Economics.xlsx` (sheet `Economics`). Rebuild this plan's constants from that sheet if it changes.

---

## 1. The unit

| Term | Value | Source |
| --- | --- | --- |
| Average generation | 10 credits | sheet `C32`, the anchor for everything below |
| Average video | about 30 credits (3 generations) | sheet `C30` |
| Raw AI cost of 1 credit | $0.0416 | sheet `C146` |
| Fully loaded cost of 1 credit | $0.0516 | sheet `C132` (adds retries, refund buffer, render, storage) |
| Price of 1 credit on paid plans | $0.0667 | sheet `F38:F40` |

Plans in the sheet are Starter 150, Pro 300 and Studio 750 credits a month. That is 5, 10 and 25 average videos.

Balances are stored as integers in **hundredths of a credit** (50 credits is `5000`). Money-like values never touch floating point in the database, and the UI can still show one decimal.

## 2. Why not a flat price per prompt

One message is not one model call, and no two messages cost the same.

- A message runs a whole LangGraph run: classify intent, select skills, select reference, write a brief, generate, then up to two repair passes (`packages/ai/graph/motion.graph.ts`).
- Cost swings with the project size, the attached images and how much the model writes back.

| Request | Input tokens | Output tokens | Credits |
| --- | --- | --- | --- |
| Chat reply | 5,000 | 1,000 | 0.5 |
| Small edit | 30,000 | 8,000 | 3.4 |
| Average generation | 80,648 | 25,470 | 10.0 |
| Heavy new film | 150,000 | 50,000 | 19.2 |

A flat 10 credits would overcharge the edit and undercharge the heavy film. Phase 2 therefore meters real tokens. Phase 1 needs no metering at all.

---

# Phase 1: Every account has credits

**Status:** Built. Backend and editor UI are on the `feat/credits-phase-1` branches.

**Outcome:** Each user has a balance, new users start with 50, and the frontend can read it. Nothing spends credits yet.

## 1.1 Data model

New migration `0014_credits.sql` and matching tables in `packages/database/schema.ts`.

`credit_accounts`, one row per user:

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid PK | references `users.id`, `on delete cascade` |
| `balance` | integer not null | hundredths of a credit, `check (balance >= 0)`. Never written by app code, see below. |
| `created_at`, `updated_at` | timestamptz | |

`credit_ledger`, append-only and the source of truth:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid not null | references `users.id` |
| `kind` | enum `credit_entry_kind` | `SIGNUP_GRANT`, `RESERVE`, `SETTLE`, `REFUND`, `ADJUSTMENT`. Later phases add `PLAN_GRANT` and `PACK_PURCHASE`. |
| `amount` | integer not null, `<> 0` | signed hundredths, positive adds credits |
| `reference_type`, `reference_id` | text, uuid | for example a generation run id |
| `note` | text | |
| `created_at` | timestamptz | |

Indexes and constraints:

- `unique (user_id) where kind = 'SIGNUP_GRANT'`, so the grant happens exactly once even if sign-in runs twice or concurrently.
- `unique (reference_id, kind) where reference_id is not null`, so a retried settle or refund cannot post twice.
- Index on `(user_id, created_at desc)` for the history endpoint.

The balance is kept in sync by the database, not by app code:

- An `AFTER INSERT` trigger on `credit_ledger` adds the row's `amount` to `credit_accounts.balance`. Code only ever inserts ledger rows, so the balance and its history cannot disagree, and `balance = sum(amount)` always holds.
- The `balance >= 0` check makes an overspend fail and roll the ledger row back with it. That is also what makes Phase 2's "reserve" safe under concurrent requests: ten parallel spends of a 50-credit balance in 10-credit pieces succeed exactly five times (covered by a test).
- A `BEFORE UPDATE` trigger refuses any change to a ledger row, so history is append-only.
- `AFTER INSERT` (not `BEFORE`) matters: a grant that hits the unique index and is skipped must not touch the balance.
- Both tables have **row level security on with no policies**, and `anon` and `authenticated` are revoked. Supabase exposes `public` tables to browsers through the publishable key, so without this a user could edit their own balance straight from the browser console, no API needed. Only the backend's database connection can reach them.

Migration: `drizzle/migrations/0014_credits.sql`.

## 1.2 Signup grant

`DatabaseAccountProvisioner.provision()` in `src/repositories/auth.repository.ts` already runs in a transaction on every login. Add to it:

1. `insert into credit_accounts ... on conflict do nothing`.
2. Insert a `SIGNUP_GRANT` ledger row of `+5000` with `on conflict do nothing`.
3. Only if that insert actually inserted a row, add the amount to the balance.

Provisioning runs on every login, so the unique index is what makes it a one-time grant. Do not tell "new" from "existing" users by the `users` upsert, which cannot.

The grant amount comes from env `SIGNUP_CREDITS` (default `50`, range 0 to 1000), read through `src/config/env.ts`.

**Backfill:** the migration gives every existing user the same 50, with a `SIGNUP_GRANT` row each, so early users are not treated worse than new ones.

## 1.3 API

```text
GET /v1/credits          -> { data: { balance: 50.0 } }
GET /v1/credits/history  -> { data: { entries: [...], nextCursor } }
```

- Both need an authenticated session. Neither needs a CSRF token because they only read.
- The balance is a separate call, not part of `GET /v1/auth/me`, so credits stay decoupled from authentication and `me` does not gain a database read.
- Both routes are read-only, ignore any user id a client sends, send `Cache-Control: no-store`, and are rate limited to 60 a minute per user. `POST`, `PUT`, `PATCH` and `DELETE` on `/v1/credits*` return 404 (tested).
- Amounts go over the wire as credits (a decimal), never as raw hundredths.
- Files: `src/repositories/credit.repository.ts`, `src/services/credit.service.ts`, `src/controllers/credit.controller.ts`, `src/routes/credit.routes.ts`, wired in `src/server.ts`. Follow the shape of the audio or workspace modules.

## 1.4 Tests and docs

- Unit: `CreditService` balance and history mapping.
- Integration: first login grants 50; second and concurrent logins still leave 50; balance never goes negative (check constraint).
- Migration: existing users are backfilled exactly once.
- `docs/api.md` and `docs/security.md` describe the endpoints and controls.

## 1.5 A cost you should decide on now

The sheet's free tier is 30 credits. At 50:

| | 30 credits | 50 credits |
| --- | --- | --- |
| Worst-case cost per free signup | $1.55 | $2.58 |
| CAC per paying customer (sheet `C62`) | $28.57 | $40.96 |
| LTV : CAC (sheet target 3.0x) | 3.43x | 2.39x |

The 50-credit start drops LTV:CAC below the sheet's target. It stays affordable at low volume, and the numbers are estimates. It is worth updating the sheet's free-tier input to match whatever you ship. One lever is a smaller start (30 to 40 credits). Another is fewer credits on free but a higher launch-week bonus.

**Done when:** a new account shows 50 credits, an old account shows 50, and reloading or logging in again never changes it.

---

# Phase 2: Generations spend credits

**Outcome:** Each generation costs credits in proportion to the tokens it used. The user is charged nothing when they got nothing.

## 2.1 Pricing rule

```text
raw_cost_usd = (input_tokens * price_in + output_tokens * price_out) / 1,000,000
credits      = raw_cost_usd / 0.0416
```

With the sheet's model prices ($2 in, $10 out per million tokens) this equals `(input + 5 * output) / 20,800`, which is the sheet's "token to credit converter".

- Prices live in a **per-model price table**, not a single constant, because `AI_PROVIDER` and `AI_MODEL` can change (Gemini, OpenAI-compatible, Anthropic, OpenRouter). A model change should re-price credits automatically, and a model missing from the table should fail loudly at startup rather than charge zero.
- Charge the **raw** AI cost only. Retries, the refund buffer, render and storage are covered by the gap between $0.0416 and the $0.0667 price of a credit.
- Images the user attaches are part of the provider's reported input tokens, so they are priced with no extra rule.
- Amounts are rounded **up** to the next hundredth of a credit.

Knobs, all in `src/config/env.ts`:

| Env var | Default | Purpose |
| --- | --- | --- |
| `CREDIT_USD_VALUE` | `0.0416` | raw AI cost of one credit |
| `CREDIT_MIN_CHARGE` | `0.5` | floor per charged message, so tiny chats are not free |
| `CREDIT_MAX_CHARGE` | `30` | ceiling per message (one full video), so a repair loop never surprises a user |
| `CREDIT_RESERVE` | `10` | held at the start of a message (an average generation) |
| `CREDITS_ENFORCED` | `false` | see 2.7 |

## 2.2 Counting tokens for real

Today the count is incomplete, and this is the first thing to fix.

- `state.tokenUsage` only collects usage from `generate` and `repair` (`packages/ai/graph/nodes/generate.node.ts`, `repair.node.ts`).
- `structured()` and chat calls return only their value, not usage (`MotionModelProvider` in `packages/ai/providers/model.provider.ts`). So intent classification, skill selection, reference selection, the brief and chat replies are all missing from `generation_runs.input_tokens` and `output_tokens`.
- When a provider throws mid-run, the usage collected so far in graph state is lost with the error.

Fix: a per-request **usage meter** kept outside the graph state.

1. Add `packages/ai/usage/usage-meter.ts` with a `UsageMeter` (`record(model, input, output)`, `total()`), held in `AsyncLocalStorage`.
2. Each provider (`gemini`, `openai`, `anthropic`, `openrouter`, `fake`) calls the meter after **every** model call, including calls that later fail validation.
3. `GenerationService.sendMessage` runs `graph.invoke` inside the meter's scope. The meter survives thrown errors, so the total is always known.
4. `generation_runs` token columns are filled from the meter. This also corrects the existing stored numbers.

Nothing in the graph nodes needs to know about credits.

## 2.3 The charge flow

Reserve first, settle at the end. Concurrent requests cannot both spend the same credits.

1. **Check and reserve.** Before any model call, atomically take `CREDIT_RESERVE` from the balance (`update ... set balance = balance - x where user_id = ? and balance >= x`). If it fails, return **402 `INSUFFICIENT_CREDITS`** with the balance and the reserve needed. Write a `RESERVE` ledger row. This happens after the project access checks in `GenerationService.sendMessage`, so a 403 or 404 never touches credits.
2. **Run** the graph with the meter.
3. **Settle**, based on how it ended:

| Outcome | What the user pays |
| --- | --- |
| `generation` saved | Actual credits (min and max applied). Refund the unused part of the reserve, or take the extra up to the remaining balance. |
| `chat` or `plan` reply | Actual credits (min applied), usually well under 1. |
| `GENERATION_INVALID` (never validated) | **Nothing.** Full reserve returned. |
| `REVISION_CONFLICT` (nothing saved) | **Nothing.** Full reserve returned. |
| Provider error (timeout, rate limit, 5xx, unusable output) | **Nothing.** Full reserve returned. |
| Any unexpected exception | **Nothing.** Full reserve returned. |

4. The settle or refund is a `SETTLE` or `REFUND` ledger row keyed by the generation run id, so a retry cannot post twice.
5. If a generation costs more than the remaining balance, take what is left. The balance never goes negative, and the difference is a small cost we absorb. The `CREDIT_MAX_CHARGE` ceiling bounds it.

**Rule of thumb:** the user pays only when Motify returned something useful. The tokens we spent on failures are the sheet's 5% refund buffer (`C28`).

Open decision: whether to bill repair passes. The default here is yes, with the 30-credit ceiling. Alternative: bill only the first-pass generation, since repairs fix the model's own mistakes. This is friendlier to users and costs the sheet's 15% retry overhead (`C14`) rather than the 5% buffer.

## 2.4 Data and API changes

- `generation_runs`: add `credits_charged integer` (hundredths) and `credit_status` (`CHARGED`, `REFUNDED`, `NOT_ENFORCED`).
- `POST /v1/projects/:projectId/messages` response adds `creditsCharged` and `creditsRemaining` under `data`.
- `docs/api.md`: add `402 INSUFFICIENT_CREDITS` to the error table and document the two new fields.
- Chat and plan replies never write a `generation_runs` row (only saved and failed generations do), so their charge is recorded in the ledger alone, keyed by a per-request id used as `reference_id`.
- A cheap pre-flight endpoint is optional: `POST /v1/credits/estimate` could return the average cost so the editor can warn "this may cost about 10 credits". It is not needed for launch.

## 2.5 Files touched

| Area | Files |
| --- | --- |
| Metering | new `packages/ai/usage/usage-meter.ts`, a price table `packages/ai/usage/pricing.ts`, all files in `packages/ai/providers/` |
| Charging | `src/services/credit.service.ts` (reserve, settle, refund), `src/repositories/credit.repository.ts` |
| Wiring | `src/services/generation.service.ts` (wrap `invokeGraph`), `src/server.ts` |
| Errors | `src/errors.ts` usage of `AppError(402, 'INSUFFICIENT_CREDITS', ...)` |
| DB | migration `0015_generation_credits.sql`, `schema.ts` |
| Docs | `docs/api.md`, `docs/architecture.md`, this file |

## 2.6 Tests

- Pricing: the table above (chat 0.5, edit 3.4, average 10.0, heavy 19.2) as fixed cases; min and max charge; unknown model fails at startup.
- Meter: usage from every provider call is counted, including calls that fail validation, and survives a thrown provider error.
- Flow: reserve then settle; every failure row in 2.3 returns the whole reserve; a repeat settle or refund is a no-op; a 402 leaves the balance untouched; two concurrent messages cannot spend the same credits.
- Fake provider (`packages/ai/providers/fake.provider.ts`) reports deterministic usage so these tests need no network.

## 2.7 Rollout

1. Ship with `CREDITS_ENFORCED=false`. The meter runs and the ledger records what **would** have been charged, but no balance moves.
2. After about a week, compare the metered averages to the sheet's guess (80,648 in, 25,470 out, 3 calls per video). Adjust `CREDIT_USD_VALUE` and the sheet before real money is involved.
3. Turn enforcement on.

---

# Later, not in these two phases

- Monthly plan grants (Starter 150, Pro 300, Studio 750) and top-up packs, with Stripe. Both add ledger kinds; nothing in Phases 1 and 2 needs rework.
- Credit expiry and rollover rules.
- Per-workspace balances for team plans. Balances live on the user for now.
- Abuse limits on free signups (disposable emails, many accounts per device), which matters more once 50 free credits are on offer.
