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

**Status:** Built, off by default (`CREDITS_ENFORCED=false`). Backend on `feat/credits-phase-2`, stacked on Phase 1.

**Outcome:** Each generation costs credits in proportion to the tokens it used. The user is charged nothing when they got nothing.

## 2.1 Pricing rule

```text
raw_cost_usd = (input_tokens * price_in + output_tokens * price_out) / 1,000,000
credits      = raw_cost_usd / 0.0416      (rounded up to a hundredth, then floor and ceiling)
```

With the sheet's prices ($2 in, $10 out per million tokens) this is `(input + 5 * output) / 20,800`, the sheet's "token to credit converter". The worked examples are test cases: a 5k/1k chat is 0.5 (the floor), a 30k/8k edit 3.37, the average 80,648/25,470 generation exactly 10.00, a 150k/50k film 19.24.

- **Prices come from the environment**, not a table keyed by model. `AI_PROVIDER` can point at OpenRouter, which routes to thousands of models, so a table would be wrong or empty most of the time. Set `AI_INPUT_PRICE_PER_MTOK` and `AI_OUTPUT_PRICE_PER_MTOK` to the real prices of `AI_MODEL`. `AI_PLANNING_MODEL` is priced the same, so keep the two in the same price class, or set the prices to the blend.
- Charge the **raw** AI cost only. Retries, the refund buffer, render and storage are covered by the gap between $0.0416 and the $0.0667 price of a credit.
- Images the user attaches are part of the input tokens the provider reports, so they are priced with no extra rule.
- If a provider answers but reports no token counts, the request is priced as one average generation (and a warning is logged), never as free.

| Env var | Default | Purpose |
| --- | --- | --- |
| `CREDITS_ENFORCED` | `false` | see 2.7 |
| `AI_INPUT_PRICE_PER_MTOK` | `2` | USD per million input tokens |
| `AI_OUTPUT_PRICE_PER_MTOK` | `10` | USD per million output tokens |
| `CREDIT_USD_VALUE` | `0.0416` | raw AI cost of one credit |
| `CREDIT_MIN_CHARGE` | `0.5` | floor per message, so a tiny chat is not free; also the least balance that can start a request |
| `CREDIT_MAX_CHARGE` | `30` | ceiling per message (one full video), so a repair loop never surprises a user |
| `CREDIT_RESERVE` | `10` | held while a request runs (an average generation) |

## 2.2 Counting tokens for real

Before this phase the count was incomplete: only `generate` and `repair` returned usage, `structured()` and chat calls returned just their value, and a provider error lost whatever had been counted. Intent classification, skill selection, reference selection, the brief and chat replies were all missing.

- `packages/ai/usage/usage-meter.ts` adds a `UsageMeter` held in `AsyncLocalStorage`. `GenerationService` runs the graph inside `runWithUsageMeter`, so every model call made anywhere in the run reports to it, and it survives a thrown error.
- Each provider (`gemini`, `openai`, `anthropic`, `openrouter`, and the fake used in tests) calls `recordModelUsage` the moment a response arrives, **before** parsing it. A response the validator rejects still cost tokens, and still counts.
- Gemini reports reasoning tokens apart from candidate tokens, so they are added to output. Anthropic cached input is counted in full: a slight overcharge, never an undercharge.
- Outside a metered request (evals, scripts) recording is a no-op.

The existing `generation_runs.input_tokens` / `output_tokens` are unchanged; the meter is what billing reads. Each charge also stores its own token counts and model on its ledger row (`credit_ledger.input_tokens`, `output_tokens`, `model`, migration `0015`), so any charge can be audited.

## 2.3 The charge flow

Hold first, settle at the end. `GenerationBilling` (`src/services/generation-billing.ts`) does it; `GenerationService.sendMessage` calls it.

1. **Hold.** After the project access checks and asset resolution, and before any model call, take `CREDIT_RESERVE` from the balance, or all that is left if that is less. The account row is locked (`select ... for update`), so overlapping requests from one user are handled in turn and cannot spend the same credits. If the balance is under `CREDIT_MIN_CHARGE` the request is refused with **402 `INSUFFICIENT_CREDITS`** (`details.balance`, `details.required`) and no model is called. A 403 or 404 never touches credits.
2. **Run** the graph with the meter.
3. **Close the hold**, based on how it ended:

| Outcome | What the user pays |
| --- | --- |
| `generation` saved | Actual credits (floor and ceiling applied). The unused part of the hold is returned, or the overrun is taken, up to what the balance has. |
| `chat` or `plan` reply | Actual credits, usually well under 1. |
| `GENERATION_INVALID` (never validated) | **Nothing.** The whole hold is returned. |
| `REVISION_CONFLICT` (nothing saved) | **Nothing.** |
| Provider error (timeout, rate limit, 5xx, unusable output) | **Nothing.** |
| Any unexpected exception | **Nothing.** |

4. A closed hold cannot be closed again. `settle` and `refund` each check the request's ledger rows under the account lock, so a retry, a double call, or a refund after a charge is a no-op. A generation that costs exactly its hold still writes a zero-amount `SETTLE` row, which is what marks it closed.
5. If a generation costs more than the balance holds, only what is left is taken. The balance never goes negative, and the difference is a small cost we absorb, bounded by `CREDIT_MAX_CHARGE`.
6. **Bookkeeping never costs the user their film.** `complete` and `abandon` never throw. If settling fails after a good result, the result is still returned and the hold is released later by the sweeper instead of charged.
7. **Stale holds.** If the server stops mid-request the hold would stay forever. `releaseStale` runs at startup and every 5 minutes and returns any hold nothing settled for 15 minutes (far longer than a request runs). A late settle for a swept hold does nothing.

**Rule of thumb:** the user pays only when Motify returned something useful. The tokens spent on failures are the sheet's 5% refund buffer (`C28`).

Repair passes are billed (default). Alternative: bill only the first-pass generation, which is friendlier and costs the sheet's 15% retry overhead (`C14`) rather than the 5% buffer. That is a one-line change in `GenerationBilling.complete` if you want it.

## 2.4 Data and API changes

- Migration `0016_generation_credits.sql`: token and model columns on `credit_ledger`, and the amount check now allows a zero `SETTLE`.
- `POST /v1/projects/:projectId/messages` adds `credits: { charged, remaining }` to `data` when charging is on, and can return `402 INSUFFICIENT_CREDITS`. Documented in `docs/api.md`.
- **History shows one line per request.** A generation writes a hold and then a settle or refund; the history endpoint groups them by request and shows the net: a charge as a negative `SETTLE` ("Generation"), a failed request as a `REFUND` of `0` ("Not charged (generation failed)"). The bookkeeping rows stay out of the user's view.
- Chat and plan replies write no `generation_runs` row, so their charge lives in the ledger alone, keyed by the per-request id.
- **Pre-send estimate.** `GET /v1/credits` also carries `estimate: { typical, min, max }` (in credits) when `CREDITS_ENFORCED=true`, taken straight from the billing config (`CREDIT_RESERVE`, `CREDIT_MIN_CHARGE`, `CREDIT_MAX_CHARGE`) rather than computed per request — nothing about the message is tokenized ahead of time. The editor scales `typical` by the length of the drafted message (`estimateMessageCredits` in `src/api/credits.ts`, frontend) and shows it once there is a message to size it from, so it reads as a live guide rather than a fixed number; it blocks sending below `min`, matching what the server would actually refuse with `402`. It is not a per-message prediction: the real charge depends on what the model returns and is only known after the request finishes.

## 2.5 Files touched

| Area | Files |
| --- | --- |
| Metering | new `packages/ai/usage/usage-meter.ts`; `gemini`, `openai`, `anthropic`, `openrouter` and `fake` providers |
| Pricing | new `src/services/credit-pricing.ts` |
| Charging | new `src/services/generation-billing.ts`; `src/repositories/credit.repository.ts` (`reserve`, `settle`, `refund`, `releaseStaleHolds`, grouped history) |
| Wiring | `src/services/generation.service.ts`, `src/server.ts` (billing, sweeper), `src/config/env.ts` |
| DB | migration `0016_generation_credits.sql`, `schema.ts` |
| Docs | `docs/api.md`, `.env.example`, this file |

## 2.6 Tests

- Pricing: the worked examples above as fixed cases; floor, ceiling, round-up, unreported usage, price changes.
- Meter: concurrent requests stay separate, usage survives a throw, and a run through the real graph reports every call.
- Providers: all four report a generation, a structured call and a chat reply, count a response the validator rejects, and flag a call with no usage.
- Billing and service: hold before any model call, 402 before a token is spent, charge equals metered usage, and every failure row in 2.3 refunds. Two overlapping requests do not mix usage.
- Real Postgres (`tests/integration/credit-ledger.test.ts`): overlapping holds on 25 credits give 10, 10, 5 and seven refusals with the balance at 0; settle below, at, and above the hold; overrun capped at the balance; nothing closes twice; another user cannot close your hold; stale holds are swept but running ones are not; grouped history pages without repeats.

## 2.7 Rollout

1. Deploy with `CREDITS_ENFORCED=false`. Requests are metered and logged as `Credits (not enforced): would have charged` with tokens, credits and USD cost, but no balance moves.
2. After about a week, compare those numbers with the sheet's guess (80,648 in, 25,470 out, 3 calls per video). Set the real prices of `AI_MODEL`, adjust `CREDIT_USD_VALUE` if needed, and update the sheet.
3. Set `CREDITS_ENFORCED=true`.

---

# Later, not in these two phases

- Monthly plan grants (Starter 150, Pro 300, Studio 750) and top-up packs, with Stripe. Both add ledger kinds; nothing in Phases 1 and 2 needs rework.
- Credit expiry and rollover rules.
- Per-workspace balances for team plans. Balances live on the user for now.
- Abuse limits on free signups (disposable emails, many accounts per device), which matters more once 50 free credits are on offer.
