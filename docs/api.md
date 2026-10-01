# API

All public API routes are versioned under `/v1`, except system endpoints. Responses use JSON and errors provide a stable code, a user-safe message, a request identifier, and optional field details.

## System

```text
GET /health
GET /ready
```

## Authentication

```text
POST /v1/auth/sign-up
POST /v1/auth/login
GET  /v1/auth/verify
GET  /v1/auth/google
GET  /v1/auth/callback
GET  /v1/auth/me
POST /v1/auth/logout
```

The backend owns the Supabase login flow and returns an opaque `motify_session` HTTP-only cookie. Successful login responses also provide a session-bound CSRF token; clients must send it as `X-CSRF-Token` for cookie-authenticated mutations. Email signup requires verification in production. Supabase redirects confirmation links to `/v1/auth/verify?code=...`; the endpoint exchanges that PKCE code and creates the Motify session. The Google endpoint starts a separate PKCE flow and accepts each stored attempt only once.

Motify has two front ends — the marketing site and the editor — so a flow that leaves the browser says where it started: `POST /v1/auth/sign-up` accepts a `returnTo` in its body and `GET /v1/auth/google` accepts one as a query parameter. It is honoured only when its origin is one of `FRONTEND_ORIGINS`; anything else falls back to the first configured origin, so the parameter can never become an open redirect. The verification and OAuth callbacks then land the browser back where the user was.

## Workspaces

```text
GET    /v1/workspaces
POST   /v1/workspaces
GET    /v1/workspaces/:workspaceId
PATCH  /v1/workspaces/:workspaceId
GET    /v1/workspaces/:workspaceId/members
POST   /v1/workspaces/:workspaceId/members
PATCH  /v1/workspaces/:workspaceId/members/:userId
DELETE /v1/workspaces/:workspaceId/members/:userId
```

## Projects

```text
GET    /v1/workspaces/:workspaceId/projects
POST   /v1/workspaces/:workspaceId/projects
GET    /v1/projects/:projectId
PATCH  /v1/projects/:projectId
DELETE /v1/projects/:projectId
```

A project is one mutable Motify composition. Its editable source is two fields — `compositionHtml` and `timelineJs` — plus the canvas settings and the scene list the frontend renders with GSAP.

```json
{
  "name": "Launch Film",
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "duration": 30,
  "scenes": [{ "id": "intro", "label": "Intro", "start": 0, "duration": 8, "accent": "#7c3aed" }],
  "compositionHtml": "<template><style>...</style>...</template>",
  "timelineJs": "export function buildTimeline(context) { ... }"
}
```

`PATCH` and `DELETE` requests include the caller's last-known `revision`. A stale write returns `409 Conflict` with `REVISION_CONFLICT` and `details.currentRevision`, so clients reload or reconcile instead of silently overwriting another edit. Deletion is a soft archive. Viewers may read projects; workspace owners and editors may mutate them.

## Assets

```text
GET    /v1/workspaces/:workspaceId/assets
POST   /v1/workspaces/:workspaceId/assets/uploads
PUT    /v1/assets/uploads/:uploadId/content
POST   /v1/workspaces/:workspaceId/assets/uploads/:uploadId/complete
GET    /v1/assets/:assetId
GET    /v1/assets/:assetId/download
DELETE /v1/assets/:assetId
POST   /v1/projects/:projectId/assets
DELETE /v1/projects/:projectId/assets/:assetId
```

The V1 local-filesystem adapter returns a short-lived authenticated API upload URL. Send the exact declared bytes and content type to that URL, then call the completion endpoint; completion verifies size and SHA-256 before marking the asset `READY`. A future S3-compatible adapter can return a signed object URL without changing this three-step lifecycle.

Assets are images (PNG, JPEG, WebP, GIF up to 20 MB; SVG up to 2 MB) or audio (MP3, WAV, OGG, M4A, AAC, WebM up to 50 MB and 20 minutes). Completion reads image dimensions or audio duration from the stored bytes. Audio assets never appear in the image asset list and cannot be attached as project images; they enter the music library instead.

Stored artifacts are read through `GET /v1/artifacts/:artifactId/download`.

## Music library

```text
GET    /v1/workspaces/:workspaceId/audio        ?scope=all|workspace|system&q=&page=&pageSize=
POST   /v1/workspaces/:workspaceId/audio
GET    /v1/audio/:trackId
GET    /v1/audio/:trackId/access
GET    /v1/audio/:trackId/download
PATCH  /v1/audio/:trackId
DELETE /v1/audio/:trackId
GET    /v1/projects/:projectId/audio
DELETE /v1/projects/:projectId/audio/:trackId
```

The library holds two kinds of track. **Workspace tracks** are songs a user uploads: send the file through the three-step asset upload, then register the completed asset.

```json
{ "assetId": "…", "title": "Bright Future", "artist": "Studio", "genre": "electronic", "moodTags": ["upbeat"], "bpm": 120 }
```

Only `assetId` is required; `title` defaults to the file name. **System tracks** are curated by Motify developers with `npm run audio:seed -- <file> --license "<license>" [--title] [--artist] [--genre] [--mood a,b] [--bpm 120]`, which reads duration and embedded tags from the file and is a no-op for a file already seeded. Every signed-in user can list, preview, and generate with system tracks; nobody can change or delete them over the API (`403 AUDIO_TRACK_READ_ONLY`).

Listing returns workspace tracks first, then system tracks, searchable across title, artist, genre, and mood tags. Each track carries a `motify-audio://<trackId>` token. `access` returns a five-minute signed URL for previews and for replacing that token in a composition. Deleting a workspace track removes its stored file and is refused with `409 AUDIO_TRACK_IN_USE` while an active project uses it; remove it from the project first.

## Brand DNA

```text
GET    /v1/workspaces/:workspaceId/brand
PUT    /v1/workspaces/:workspaceId/brand
POST   /v1/workspaces/:workspaceId/brand/assets
PATCH  /v1/workspaces/:workspaceId/brand/assets/:assetId
DELETE /v1/workspaces/:workspaceId/brand/assets/:assetId
```

Each workspace has one Brand DNA: the single source of truth for what the brand is, how it looks and sounds, and how its films are cut. Every generation in the workspace loads it on the server and passes it to the brief, generation and repair prompts; the editor never has to send it. The user's request for a film still wins where it contradicts the brand.

`GET` always succeeds for a member. A workspace with no brand yet returns an empty document at `revision: 0`. The document (`dna`) is versioned JSON defined in `packages/brand/brand-dna.ts`, with sections `identity`, `visual` (colours, fonts), `product`, `story` (problem, solution, differentiators, proof) and `voice`. `PUT` replaces the whole document against the revision it was read at:

```json
{ "revision": 3, "dna": { "identity": { "name": "Acme", "websiteUrl": "acme.com" }, "visual": { "fonts": [{ "id": "f1", "family": "Inter", "role": "heading" }] } } }
```

Omitted fields take their empty defaults, website URLs gain `https://`, and hex colours are lower-cased. A stale revision returns `409 BRAND_REVISION_CONFLICT` with `details.currentRevision`. Viewers get `403`.

Images (logo, favicon, logo variants, screenshots, product images, icons) are ordinary assets: upload through the three-step asset flow, then link the completed asset with `{ "assetId": "…", "role": "logo" | "favicon" | "logo_variant" | "screenshot" | "image" | "icon", "label": "…" }`. A brand holds one logo and one favicon, so linking a new one replaces the old one. Removing an image from the brand, or replacing it, deletes its file unless a project still uses it. The asset delete endpoint refuses (`409 ASSET_IN_USE`) while an image is part of the brand. Generations may place brand images through their `motify-asset://` tokens but are never required to, and the favicon is never offered to the model.

Fonts are either a `preset` (a typeface Motionly bundles or every system has, named by family) or an `upload`: the brand's own `.ttf`, `.otf`, `.woff` or `.woff2` files, uploaded through the asset flow (10 MB each), linked with role `font`, and listed on the font as `files: [{ "assetId", "weight", "style" }]`. A save that points a font at a file the brand does not hold is refused with `422 BRAND_FONT_NOT_FOUND`, and a file dropped from the document by a save is unlinked and deleted. Generations are told to declare uploaded fonts with `@font-face` over their `motify-asset://` tokens. The editor unpacks `.zip` font packages in the browser, so the API only ever receives font files. Font assets are left out of the workspace image library.

`provenance` records, per field, whether a person (`manual`) or Site Intelligence (`site_intelligence`) set it. Site Intelligence writes through `BrandService.applySuggestion`, which fills empty fields and refreshes fields it set before, but never overwrites a field a person typed unless it is explicitly asked to.

## Billing (Bakong KHQR)

```text
GET  /v1/billing/plans
GET  /v1/billing/credit-packs
GET  /v1/workspaces/:workspaceId/billing/subscription
POST /v1/workspaces/:workspaceId/billing/payments
GET  /v1/payments/:paymentId
```

Plans are bought per workspace by paying a Bakong KHQR, the QR code any Cambodian banking app can scan. The routes are mounted only when `BAKONG_TOKEN` and `BAKONG_ACCOUNT_ID` are set. `plans` needs no session and lists the catalog. Prices, credits, names and which plans are on sale come from the `PLAN_<ID>_*` and `BILLING_PERIOD_DAYS` settings (see `.env.example`), so a price change is a config change and a restart, not a code change. Point the pricing page at this endpoint to keep it in step. A new price applies to new checkouts; an open QR keeps charging the price it showed.

A checkout buys either a plan or a credit pack. A workspace owner buys a plan with `{ "plan": "starter" | "pro" }`; any member buys credits with `{ "creditPack": "credits-135" }`, an id from `credit-packs`. Send exactly one of the two. The response carries the KHQR string in `qr`; render it as a QR image, or pass it to Bakong's deeplink on mobile. It expires at `expiresAt`, 3 minutes by default. Asking again for the same plan (or, for packs, the same pack by the same member) while a checkout is open returns that checkout instead of a new QR. A plan not on sale returns `409 PLAN_UNAVAILABLE`, a pack not on sale `409 CREDIT_PACK_UNAVAILABLE`, and a member who is not an owner gets `403` for a plan.

```json
{ "data": { "id": "…", "kind": "PLAN", "plan": "pro", "creditPack": null, "credits": 300, "amount": 20, "currency": "USD", "billNumber": "MTF-7KQ2M9XH4P", "status": "PENDING", "qr": "000201…", "expiresAt": "…", "paidAt": null, "createdAt": "…" } }
```

Bakong sends no webhooks, so the client polls `GET /v1/payments/:paymentId` every 3–5 seconds while the QR is on screen. Each poll of a `PENDING` payment asks Bakong's `check_transaction_by_md5`, at most once every 3 seconds per payment. When Bakong reports a transaction to our account for the exact amount and currency, the payment becomes `PAID` and, in the same database transaction, the workspace plan is activated (plan checkouts) and the payment's `credits` are added to the member who paid. The response then includes `subscription` (plan checkouts) and, for the member who paid, `creditBalance`. The API also sweeps every `PENDING` payment every `BAKONG_RECONCILE_INTERVAL_SECONDS`, so a plan still activates when the payer closes the tab.

| Status | Meaning |
| --- | --- |
| `PENDING` | Waiting for the payer. `qr` is set. |
| `PAID` | Money received; plan active. |
| `EXPIRED` | Not paid within `expiresAt` plus a 2-minute grace period. Start a new checkout. |
| `FAILED` | Bakong reported the transaction failed, or it did not match the order (logged for manual review). |

If Bakong cannot be reached, the payment stays `PENDING` instead of expiring, so an outage never loses a payment.

A subscription lasts 30 days from payment. Paying for the plan that is already active extends it by 30 days; paying for a different plan, or after the period lapsed, starts a new 30-day period at payment time. KHQR has no automatic recurring charge, so each period is a new checkout.

```json
{ "data": { "status": "active", "plan": "pro", "currentPeriodStart": "…", "currentPeriodEnd": "…" } }
```

To test a real payment without a frontend, run `npm run payments:test -- --email <account email> [--plan starter]`. It opens a checkout for that account's personal workspace, prints the KHQR in the terminal and saves it as a PNG, then polls until Bakong confirms and the plan activates. It charges real money to `BAKONG_ACCOUNT_ID`.

`status` is `none` for a workspace that never paid, and `expired` once `currentPeriodEnd` has passed. Each plan payment, including a renewal, adds that plan's credits to the payer's balance. Credits are fixed when the checkout is created, so a later change to `PLAN_<ID>_CREDITS` or `CREDIT_PACKS` does not change what an open checkout grants. Credits from plans and packs do not expire.

```json
{ "data": [{ "id": "credits-30", "price": 2.5, "currency": "USD", "credits": 30 }, { "id": "credits-65", "price": 5, "currency": "USD", "credits": 65 }] }
```

`credit-packs` needs no session and lists the packs from `CREDIT_PACKS` (default `2.50:30,5:65,10:135,25:350,50:720,100:1450`).

## Cloud AI generation

## Cloud AI generation

```text
POST /v1/projects/:projectId/messages
```

One endpoint drives the Motify conversation for an existing project: discussing an idea, planning changes, editing it, and repairing it after a renderer failure.

```json
{
  "message": "Make the headline larger and slow the intro.",
  "revision": 7,
  "runtimeError": { "message": "buildTimeline is not a function" }
}
```

Only `message` is required. `revision` is the revision the client generated against. `runtimeError` reports a renderer failure and requires `revision`. Unknown fields are rejected.

`audio` scores the film to music-library tracks: `"audio": [{ "trackId": "…" }]`, at most three. The model receives each track's title, duration, tempo, and mood (never the audio itself), paces scenes to it, and must place it as `<audio data-motify-audio src="motify-audio://<trackId>" data-start="0">`; the editor, not `timelineJs`, plays it in sync with the playhead. Requested tracks are attached to the project, and later messages without `audio` keep using them, so an edit does not drop the soundtrack. Omitted tracks fail validation as `REQUIRED_AUDIO_MISSING`. A track from another workspace returns `404 AUDIO_TRACK_NOT_FOUND`.

The endpoint needs an authenticated session, `X-CSRF-Token`, and write access to the addressed project; viewers cannot generate. It is rate limited to 60 requests per minute per user. There is no `Idempotency-Key`, no job to poll, cancel, retry, or apply: one call returns the finished result.

| `data.type` | Status | Meaning |
| --- | --- | --- |
| `chat` | 200 | Conversational reply in `response`. Nothing is written. |
| `plan` | 200 | Proposed approach in `response`. Nothing is written. |
| `generation` | 200 | The project was written. Carries `response`, `projectId`, and `revision`. |

```json
{
  "data": {
    "type": "generation",
    "response": "Made the headline larger and slowed the intro.",
    "projectId": "9a4f2e10-7b53-4a1c-9f0d-2c8b6d5e1a33",
    "revision": 8
  }
}
```

| Error code | Status | Cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Malformed body, or `runtimeError` sent without `revision`. |
| `FORBIDDEN` | 403 | Viewer role. |
| `CSRF_INVALID` | 403 | Missing or wrong `X-CSRF-Token`. |
| `PROJECT_NOT_FOUND` | 404 | The addressed project is unavailable to the caller. |
| `REVISION_CONFLICT` | 409 | The project moved while generating; `details.currentRevision` is the revision to reload. |
| `GENERATION_INVALID` | 422 | The model never produced valid source; `details.errors` lists the diagnostics. |
| `INSUFFICIENT_CREDITS` | 402 | Fewer credits than one request needs; `details` has `balance` and `required`. No model was called. |
| `RATE_LIMITED` | 429 | Per-user request limit. |
| `PROVIDER_RATE_LIMITED` | 429 | The model provider throttled the request. |
| `PROVIDER_TIMEOUT` | 504 | The model did not answer in time. |
| `PROVIDER_UNAVAILABLE` | 503 | The provider is temporarily down. |
| `PROVIDER_*` | 502 | Any other provider failure. |

Behind the endpoint, a LangGraph workflow classifies the request, loads the project with the last twelve messages, selects Motify skills, generates one schema-constrained candidate, validates it without executing it, and repairs a rejected candidate at most twice. A valid candidate replaces the addressed revision in one revision-checked transaction. Every turn is recorded in `messages`, and every attempt in `generation_runs`.

The provider is chosen by `AI_PROVIDER` with `AI_MODEL`; only the selected provider's API key is required. The backend never renders, previews, or exports — the frontend runs the generated source. Implementation detail lives in `cloud-ai-implementation.md`.

## Credits

```text
GET /v1/credits
GET /v1/credits/history?limit=20&cursor=...
```

Every account has a credit balance. New accounts start with `SIGNUP_CREDITS` (default 50); accounts that existed when credits shipped were granted 50 by migration. Both endpoints need an authenticated session and are **read-only**: there is no endpoint to set, add, or spend credits, and the user is always the session's own, so a client cannot read or change anyone else's. Responses are `Cache-Control: no-store` and rate limited to 60 requests per minute per user.

```json
{ "data": { "balance": 50 } }
```

With `CREDITS_ENFORCED=true`, the response also carries `estimate`, so the editor can show what a request will cost **before** it is sent:

```json
{ "data": { "balance": 50, "estimate": { "typical": 10, "min": 0.5, "max": 30 } } }
```

`estimate` is fixed for the deployment, not computed per request: `typical` is what an average generation costs, `min` is the fewest credits a request needs to be accepted at all (below it, `POST /v1/projects/:projectId/messages` returns `402 INSUFFICIENT_CREDITS`), and `max` is the most any single request can ever cost. `estimate` is absent when credits are not being charged for.

`history` lists ledger entries newest first. `limit` is 1 to 50 (default 20); pass the returned `nextCursor` as `cursor` for the next page. Unknown query fields are rejected and a cursor the server did not issue returns `400 INVALID_CURSOR`.

```json
{
  "data": {
    "entries": [
      { "id": "…", "kind": "SIGNUP_GRANT", "amount": 50, "description": "Welcome credits", "createdAt": "2026-09-28T09:00:00.000Z" }
    ],
    "nextCursor": null
  }
}
```

`amount` is in credits and signed (a spend is negative). A request shows as one entry with its net cost: a charged generation is negative, and one that failed is `REFUND` with an amount of `0` ("Not charged").

### Charging

With `CREDITS_ENFORCED=true`, `POST /v1/projects/:projectId/messages` charges for the tokens the request really used, across every model call it made, so a small edit costs a few credits and a full film about ten. Credits are held before any model runs, then the real cost is charged and the rest of the hold returned. **Nothing is charged when the user gets nothing:** a provider error, a timeout, a film that never validated (`GENERATION_INVALID`) and a `REVISION_CONFLICT` all return the whole hold. The response then carries what it cost and what is left:

```json
{ "data": { "type": "generation", "response": "…", "projectId": "…", "revision": 8, "credits": { "charged": 3.4, "remaining": 46.6 } } }
```

`credits` is absent when charging is off. Pricing and the environment variables are in `credits.md`.

## Rendering

```text
GET  /v1/projects/:projectId/renders
POST /v1/projects/:projectId/renders
GET  /v1/renders/:renderId
POST /v1/renders/:renderId/cancel
POST /v1/renders/:renderId/retry
GET  /v1/renders/:renderId/artifacts
GET  /v1/render-artifacts/:artifactId/download
```

Render submission returns `202 Accepted`. Clients initially poll job state; server-sent events or WebSockets may be added later without changing the job model. Retryable mutations should accept idempotency keys.
