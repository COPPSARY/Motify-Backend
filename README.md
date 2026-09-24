# Motify Backend

The backend service for [Motify](../motionly), a code-first motion graphics editor built around TypeScript compositions, HTML/SVG, GSAP timelines, and direct browser preview.

This repository will provide the optional server-side capabilities required for hosted and self-hosted Motify installations: authentication, workspaces, project persistence, rolling source snapshots, asset storage, render jobs, and collaboration infrastructure.

> [!IMPORTANT]
> The authored `composition.html`, `styles.css`, `timeline.js`, and `index.ts` files remain the only project source. The backend must not introduce a JSON animation document, a second project representation, an interpreter, or a separate rendering model. The TypeScript adapter must continue to provide `CompositionDefinition.build()` to preview and rendering.

## Project status

V1 Area 1, Authentication, has its core implementation in place. Real PostgreSQL/Supabase integration coverage and broader authentication lifecycle tests remain follow-up validation work.

V1 Area 2, Projects, is implemented end to end: workspace-owned project CRUD, one rolling four-file source snapshot per project, no-op save detection, optimistic concurrency, soft deletion, the database migration, and Motify frontend Open/Save integration.

## Goals

- Keep Motify usable as a local, frontend-only open-source editor.
- Add an optional backend for accounts, teams, saved projects, assets, and rendering.
- Make the backend straightforward to self-host.
- Keep infrastructure provider-independent through small adapters.
- Preserve the authored HTML, scoped CSS, GSAP timeline, and thin TypeScript adapter without converting them to another format.
- Separate interactive API work from resource-intensive rendering.
- Establish secure multi-tenant access from the first database migration.

## Non-goals

- Replacing the existing Motify composition runtime.
- Defining a JSON-based animation or project DSL.
- Executing user-authored TypeScript inside the API process.
- Storing large binary media directly in PostgreSQL.
- Splitting the first release into many independently deployed microservices.
- Implementing realtime collaborative editing before normal save/revision conflict handling is reliable.

## Proposed technology stack

| Concern | Default implementation | Portability boundary |
| --- | --- | --- |
| Runtime | Node.js 22.12 or newer | Standard Node.js deployment |
| Language | TypeScript | Shared types with the Motify ecosystem |
| HTTP API | Express.js | OpenAPI is the client contract |
| Validation | Zod | Request and response schemas remain framework-neutral |
| Database | Supabase PostgreSQL | Standard PostgreSQL accessed through Drizzle |
| ORM and migrations | Drizzle ORM and Drizzle Kit | Generated SQL migrations are committed |
| Authentication | Adapter-based JWT/OIDC authentication | Supabase Auth can be the first adapter |
| Object storage | Deferred to V1 Area 3 | Provider will be selected when asset storage is implemented |
| Rendering | Separate Node.js worker in an isolated container | Never runs inside the API process |
| Local development | Supabase | Supabase provides database and authentication |
| API documentation | OpenAPI | Used to generate or verify frontend contracts |
| Testing | Vitest plus integration tests | Testcontainers or Docker Compose for infrastructure tests |

Motify uses one Supabase project for PostgreSQL and authentication. The API connects directly to the project's PostgreSQL endpoint through Drizzle and calls Supabase Auth through its HTTPS API.

## System architecture

```text
Motify web editor
        |
        | HTTPS / JSON
        v
Motify API
  |     |       |
  |     |       +--------> S3-compatible object storage
  |     |                    assets and render artifacts
  |     |
  |     +----------------> PostgreSQL
  |                          users, workspaces, projects,
  |                          latest source snapshots and job state
  |
  +----------------------> Durable render queue
                                  |
                                  v
                         Isolated render worker
                                  |
                                  +----> object storage
                                  +----> render-job progress
```

The first implementation is a modular monolith with two processes:

1. **API process** — authentication, authorization, project operations, asset metadata, signed URLs, and render-job submission.
2. **Renderer process** — claims queued work, compiles and mounts the source snapshot pinned to a render job, exports frames/video, uploads artifacts, and reports progress.

Only the renderer is separated from the API initially. Additional microservices should be introduced only when measured operational requirements justify them.

## Proposed repository structure

The current backend source lives in the repository-root `src/` directory. The following diagram is retained as an earlier architecture proposal.

```text
motify_backend/
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ app.ts
│  │     ├─ server.ts
│  │     ├─ config/
│  │     ├─ middleware/
│  │     └─ modules/
│  │        ├─ auth/
│  │        ├─ health/
│  │        ├─ workspaces/
│  │        ├─ projects/
│  │        ├─ assets/
│  │        └─ renders/
│  └─ renderer/
│     └─ src/
│        ├─ worker.ts
│        ├─ compiler/
│        ├─ sandbox/
│        ├─ exporters/
│        └─ progress/
├─ packages/
│  ├─ contracts/             # Shared request/response schemas
│  ├─ database/              # Drizzle schema and database client
│  ├─ auth/                  # Authentication interfaces and adapters
│  ├─ storage/               # Object-storage interface and adapters
│  ├─ queue/                 # Render-queue interface and adapters
│  ├─ observability/         # Logging, tracing, and metrics helpers
│  └─ config/                # Shared TypeScript, lint, and test config
├─ drizzle/
│  └─ migrations/
├─ docs/
│  ├─ architecture.md
│  ├─ api.md
│  ├─ security.md
│  └─ self-hosting.md
├─ docker-compose.yml
├─ Dockerfile.api
├─ Dockerfile.renderer
├─ .env.example
├─ package.json
└─ README.md
```

## Source-of-truth boundary

A Motify project is TypeScript source implementing `CompositionDefinition`. The backend stores the latest saved four-file snapshot as text and atomically replaces it on a changed save.

The visual editor may keep temporary overrides in browser memory while a user is interacting, but a saved edit must become a TypeScript source change. Persisting visual overrides as an independent animation document would create two competing sources of truth and is not permitted.

Compilation output may be cached as a derived artifact. It is never the editable project source and can always be regenerated from a saved source snapshot and its dependencies.

## Initial database model

### `profiles`

Application profile information associated with the identity supplied by the configured authentication provider.

| Column | Purpose |
| --- | --- |
| `id` | UUID matching the authenticated user identifier |
| `display_name` | User-facing name |
| `avatar_url` | Optional profile image |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

### `workspaces`

| Column | Purpose |
| --- | --- |
| `id` | Workspace UUID |
| `name` | Display name |
| `slug` | Stable URL identifier |
| `owner_id` | Owning user |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

### `workspace_members`

| Column | Purpose |
| --- | --- |
| `workspace_id` | Workspace reference |
| `user_id` | Member reference |
| `role` | `owner`, `editor`, or `viewer` |
| `created_at` | Membership timestamp |

The `(workspace_id, user_id)` pair is unique. Authorization must be checked at the workspace boundary for every project, asset, and render operation.

### `projects`

| Column | Purpose |
| --- | --- |
| `id` | Project UUID |
| `workspace_id` | Owning workspace |
| `name` | Project name |
| `slug` | Workspace-local URL identifier |
| `width` / `height` | Composition dimensions |
| `fps` | Composition frame rate |
| `duration` | Composition duration in seconds |
| `source_hash` | SHA-256 hash used to skip unchanged saves |
| `revision` | Optimistic-concurrency counter |
| `created_by` | Creator identifier |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |
| `saved_at` | Last changed source-save timestamp |
| `archived_at` | Optional soft-delete timestamp |

### `project_files`

| Column | Purpose |
| --- | --- |
| `project_id` | Project reference |
| `path` | One of `composition.html`, `styles.css`, `timeline.js`, or `index.ts` |
| `content` | Complete authored file content |
| `content_hash` | Per-file SHA-256 integrity hash |
| `updated_at` | Snapshot replacement timestamp |

Each project owns exactly four rows. A changed save replaces all four rows in one transaction; an identical source hash produces no database write. The API represents the rows as a keyed transport object, not as a separate animation document or editable project model.

### `assets`

| Column | Purpose |
| --- | --- |
| `id` | Asset UUID |
| `workspace_id` | Owning workspace |
| `object_key` | Private object-storage key |
| `original_name` | Original filename |
| `mime_type` | Verified MIME type |
| `byte_size` | File size |
| `checksum` | Content checksum |
| `metadata` | JSON metadata such as dimensions and duration |
| `created_by` | Uploader identifier |
| `created_at` | Creation timestamp |

Binary content is stored in object storage, not in PostgreSQL.

### `project_assets`

| Column | Purpose |
| --- | --- |
| `project_id` | Project reference |
| `asset_id` | Asset reference |
| `alias` | Stable name used by the composition |

### `render_jobs`

| Column | Purpose |
| --- | --- |
| `id` | Job UUID |
| `project_id` | Project reference |
| `project_version_id` | Immutable source version to render |
| `status` | `queued`, `running`, `completed`, `failed`, or `cancelled` |
| `format` | `png`, `webm`, or `mp4` |
| `width` / `height` | Requested output size |
| `fps` | Requested output frame rate |
| `progress` | Normalized progress value |
| `attempt_count` | Processing attempts |
| `error_code` | Safe machine-readable failure code |
| `error_message` | Safe user-facing failure message |
| `requested_by` | Requesting user |
| `created_at` | Submission timestamp |
| `started_at` | Processing timestamp |
| `completed_at` | Completion timestamp |

### `render_artifacts`

| Column | Purpose |
| --- | --- |
| `id` | Artifact UUID |
| `render_job_id` | Parent render job |
| `object_key` | Private output-storage key |
| `mime_type` | Output MIME type |
| `byte_size` | Output size |
| `checksum` | Output checksum |
| `created_at` | Creation timestamp |

## Initial API contract

All endpoints are versioned under `/v1`. JSON responses use consistent error objects with a stable code, user-safe message, request identifier, and optional field details.

### System

```text
GET    /health
GET    /ready
GET    /openapi.json
```

### Workspaces

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

### Projects and rolling source snapshot

```text
GET    /v1/workspaces/:workspaceId/projects
POST   /v1/workspaces/:workspaceId/projects
GET    /v1/projects/:projectId
PATCH  /v1/projects/:projectId
DELETE /v1/projects/:projectId
GET    /v1/projects/:projectId/source
```

Source is saved through `PATCH /v1/projects/:projectId`, with `compositionHtml` and `timelineJs` alongside any other changed fields; there is no separate source-write route. The request carries the last known project `revision`. A stale revision returns `409 Conflict`; a matching revision atomically replaces the stored files and increments it.

### Assets

```text
GET    /v1/workspaces/:workspaceId/assets
POST   /v1/workspaces/:workspaceId/assets/uploads
POST   /v1/workspaces/:workspaceId/assets/uploads/:uploadId/complete
GET    /v1/assets/:assetId
GET    /v1/assets/:assetId/download
DELETE /v1/assets/:assetId
POST   /v1/projects/:projectId/assets
DELETE /v1/projects/:projectId/assets/:assetId
```

Uploads use short-lived signed URLs so large files travel directly between the browser and object storage. Completion verifies the stored object before creating or activating the asset record.

### Rendering

```text
GET    /v1/projects/:projectId/renders
POST   /v1/projects/:projectId/renders
GET    /v1/renders/:renderId
POST   /v1/renders/:renderId/cancel
POST   /v1/renders/:renderId/retry
GET    /v1/renders/:renderId/artifacts
GET    /v1/render-artifacts/:artifactId/download
```

Render submission returns `202 Accepted`. Clients poll job state initially; server-sent events or WebSockets can be added later without changing the underlying job model.

## Frontend integration

The Motify frontend remains independently runnable. Server features are enabled only when an API URL is configured.

```env
VITE_MOTIFY_API_URL=http://localhost:3000
```

Expected behavior:

- Without an API URL, Motify continues to run as a local editor with browser downloads.
- With an API URL, Open and Save operate on each project's latest persisted snapshot.
- Asset import uses the backend's signed-upload workflow.
- Export can submit remote render jobs while retaining local PNG frame export.
- The frontend never receives database credentials, storage service credentials, or authentication service secrets.

Shared contracts should be published as a small versioned package such as `@motify/contracts`, or generated from the backend OpenAPI document. The backend must not import frontend UI code.

## Security model

User-authored TypeScript must be treated as untrusted code.

- Never compile or execute compositions in the API process.
- Run rendering in an isolated, disposable environment with CPU, memory, process, filesystem, and time limits.
- Deny access to host credentials and internal networks from render jobs.
- Mount only the pinned project source and explicitly referenced assets.
- Allow only approved dependencies or a locked dependency manifest.
- Validate asset size, extension, MIME type, and content before use.
- Keep object-storage buckets private and issue short-lived signed URLs.
- Enforce workspace authorization in the service layer and database policies.
- Never expose service-role keys or database credentials to the browser.
- Redact secrets and internal exception details from API responses and logs.
- Use idempotency keys for render submission and other retryable mutations.
- Record security-relevant actions in an audit log when team collaboration is introduced.

## Configuration plan

The initial `.env.example` should document variables without containing usable secrets:

```env
NODE_ENV=development
API_HOST=0.0.0.0
API_PORT=3000
API_PUBLIC_URL=http://localhost:3000
FRONTEND_ORIGINS=http://localhost:5173
LOG_LEVEL=info

DATABASE_URL=postgresql://postgres.PROJECT_REF:YOUR_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require

SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SESSION_ENCRYPTION_KEY=replace_with_base64_encoded_32_byte_key
SESSION_COOKIE_SECURE=false

RENDER_JOB_TIMEOUT_SECONDS=900
RENDER_MAX_ATTEMPTS=3
```

Environment variables must be parsed and validated once at process startup. Invalid or missing production configuration should stop the process with a clear error.

## Motify Cloud Backend V1 implementation plan

The seven areas below are the shared V1 delivery plan and should be implemented in this order. Infrastructure work may be introduced earlier when another area depends on it, but Area 7 is not complete until every listed production capability is operational and documented.

### 1. Authentication

**Scope:** sign up and login, sessions, and user accounts.

- Support verified email/password signup and login.
- Support Google login through the authentication-provider adapter.
- Maintain opaque, revocable server-side sessions.
- Protect cookie-authenticated mutations against CSRF.
- Provision application accounts and their personal workspaces.
- Enforce workspace roles and tenant isolation.
- Complete real PostgreSQL/Supabase integration and authentication lifecycle tests.

**Exit condition:** a user can create and verify an account, log in, restore an existing session, retrieve their account, and log out; authenticated users cannot access another workspace.

**Status:** core implementation is present; integration and lifecycle validation remain.

### 2. Projects

**Scope:** create, save, update, and delete projects; project ownership; and one rolling latest-save snapshot.

- Add project and four-file rolling-snapshot tables.
- Implement project create, read, update, and delete endpoints.
- Scope every project operation to an authorized workspace member.
- Store the four authored source files as the only project representation.
- Add revision-aware saving and optimistic concurrency checks.
- Skip unchanged source saves using a deterministic hash.
- Atomically replace the previous snapshot after a changed save.
- Connect Motify Open and Save actions to the API.

**Exit condition:** an authorized user can create, open, edit, save, reload, and delete a project without accessing projects owned by another workspace, introducing a second source representation, or accumulating save history.

### 3. Storage

**Scope:** project source and code, uploaded assets, rendered videos, and thumbnails.

- Keep the latest project source snapshot and metadata in PostgreSQL.
- Define a provider-independent object-storage interface.
- Implement the first S3-compatible storage adapter.
- Add signed upload and download operations for large files.
- Verify uploads before activating asset records.
- Validate asset size, filename, MIME type, and extracted metadata.
- Associate assets with projects without duplicating stored objects.
- Store rendered videos and thumbnails as private artifacts.

**Exit condition:** authorized users can persist project source and securely upload, reference, download, and remove project assets and render artifacts without proxying large file bodies through the API.

### 4. AI

**Scope:** AI generation, Motify skills, project context, code generation and validation, refinement, and conversation history.

- Define a provider-independent AI service interface.
- Load the approved Motify skills needed for generation.
- Build bounded project context from source, metadata, and conversation state.
- Generate TypeScript composition code without introducing another project format.
- Validate generated code before it can be saved or rendered.
- Support refinement and regeneration from prior output and user feedback.
- Persist conversation history with project and workspace authorization.
- Add usage limits, timeouts, safe error handling, and secret redaction.

**Exit condition:** an authorized user can generate, validate, refine, and save a Motify TypeScript composition using project-aware conversation history.

### 5. Rendering

**Scope:** secure sandboxing, HTML/SVG and GSAP execution, a headless browser, FFmpeg, video rendering, and thumbnail generation.

- Run rendering outside the API process in an isolated, disposable sandbox.
- Compile and execute the pinned TypeScript composition with the Motify runtime.
- Render HTML/SVG and GSAP timelines deterministically in a headless browser.
- Restrict CPU, memory, processes, filesystem access, network access, and execution time.
- Capture deterministic frames before adding encoded output formats.
- Encode supported video formats with FFmpeg.
- Generate representative thumbnails.
- Upload outputs through the storage interface.

**Exit condition:** the isolated renderer can turn a pinned project version and asset set into a reproducible video and thumbnail without exposing host credentials or internal services.

### 6. Render Jobs

**Scope:** queue, workers, progress, status, retry, cancellation, and error handling.

- Define the queue-provider interface and durable render-job lifecycle.
- Add render submission and status endpoints.
- Process jobs with separately deployed render workers.
- Record progress and artifact creation durably.
- Support cancellation and bounded automatic retries.
- Distinguish retryable failures from permanent failures.
- Handle duplicate delivery, stale jobs, worker crashes, and cleanup.
- Pin every job to an immutable project version and asset set.

**Exit condition:** an authorized user can submit, monitor, cancel, and retry a render job, and a worker can reliably produce downloadable artifacts or a clear terminal error.

### 7. Infrastructure

**Scope:** database, object storage, job queue, render workers, CDN, logging and monitoring, and secrets management.

- Maintain PostgreSQL schemas, migrations, health checks, backups, and restore procedures.
- Provision private object storage and lifecycle policies.
- Operate a durable job queue and isolated render-worker fleet.
- Deliver downloadable artifacts through a CDN or equivalent edge layer.
- Add structured logs, metrics, traces, dashboards, and alerts.
- Centralize secrets management and rotation procedures.
- Add graceful API shutdown and worker job draining.
- Add dependency, container, and deployment security checks.
- Maintain local, hosted, and self-hosted deployment documentation.
- Add end-to-end tests covering authentication through final artifact delivery.

**Exit condition:** V1 has repeatable deployments, documented recovery procedures, protected secrets, operational visibility, scalable render workers, and verified end-to-end behavior.

Realtime collaboration and presence are intentionally deferred until after V1 project saving and version conflict handling are reliable.

## Testing strategy

The repository should use multiple levels of verification:

- Unit tests for domain rules, validation, adapters, and authorization decisions.
- Database integration tests against real PostgreSQL migrations.
- API integration tests using the Express application with Supertest, without opening a public port.
- Storage contract tests shared by the selected storage adapters.
- Queue contract tests covering retries, duplicate delivery, cancellation, and stale jobs.
- Renderer fixtures for deterministic frames and expected failures.
- Security tests proving cross-workspace access is denied.
- End-to-end tests connecting a Motify frontend build to the backend.

Every migration must be tested both from an empty database and from the previous released schema.

## Versioning and compatibility

- Version HTTP routes under `/v1`.
- Publish an OpenAPI document from the same schemas used for runtime validation.
- Keep backward-compatible API changes within a major API version.
- Store a composition-runtime compatibility version with saved source or render jobs when runtime versions begin to diverge.
- Pin renderer images and dependencies so an old source version remains reproducible.
- Use semantic versioning for releases and shared packages.

## Deployment profiles

### Local development

```text
API + renderer on the developer machine
Supabase PostgreSQL and Auth
```

### Simple hosted deployment

```text
API on a Node.js host
Renderer on a separate worker/container host
Supabase PostgreSQL
S3-compatible object storage
Supabase Auth
```

### Self-hosted production

```text
Reverse proxy
Replicated API processes
One or more isolated renderer workers
Supabase PostgreSQL with backups
S3-compatible storage
Configured OIDC provider
Durable queue
```

The backend does not require Vercel. The current Authentication implementation uses Supabase for PostgreSQL and authentication.

## V1 delivery tracker

- [x] Repository and API foundation
- [ ] Authentication — core implementation present; integration and lifecycle validation remain
- [x] Projects — backend, database, and frontend Open/Save/version integration complete
- [ ] Storage
- [ ] AI
- [ ] Rendering
- [ ] Render Jobs
- [ ] Infrastructure — partially present and completed incrementally across V1

## Relationship to the frontend repository

Development may use sibling repositories:

```text
Desktop/
├─ motionly/
└─ motionly-backend/
```

Neither repository should reach into the other repository's source files at runtime. Local integration happens over HTTP. Shared types are exchanged through a published package or generated OpenAPI client so each repository can be cloned, tested, versioned, and deployed independently.

## License

Choose and add an open-source license before accepting external contributions. Using the same Apache-2.0 license as the Motionly frontend is the simplest default unless the maintainers intentionally want different terms.
