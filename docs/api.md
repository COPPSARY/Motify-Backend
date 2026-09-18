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

Stored artifacts are read through `GET /v1/artifacts/:artifactId/download`.

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
| `RATE_LIMITED` | 429 | Per-user request limit. |
| `PROVIDER_RATE_LIMITED` | 429 | The model provider throttled the request. |
| `PROVIDER_TIMEOUT` | 504 | The model did not answer in time. |
| `PROVIDER_UNAVAILABLE` | 503 | The provider is temporarily down. |
| `PROVIDER_*` | 502 | Any other provider failure. |

Behind the endpoint, a LangGraph workflow classifies the request, loads the project with the last twelve messages, selects Motify skills, generates one schema-constrained candidate, validates it without executing it, and repairs a rejected candidate at most twice. A valid candidate replaces the addressed revision in one revision-checked transaction. Every turn is recorded in `messages`, and every attempt in `generation_runs`.

The provider is chosen by `AI_PROVIDER` with `AI_MODEL`; only the selected provider's API key is required. The backend never renders, previews, or exports — the frontend runs the generated source. Implementation detail lives in `cloud-ai-implementation.md`.

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
