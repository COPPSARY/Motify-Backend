# Architecture

Motify Backend is an optional, provider-independent service for the Motify editor. Motify remains usable as a local, frontend-only editor when no API URL is configured.

## Source of truth

A project consists of four authored source files: `composition.html`, `styles.css`, `timeline.js`, and a thin `index.ts` adapter implementing `CompositionDefinition`. The backend stores one rolling snapshot of those files and atomically replaces it after a changed save. It must not introduce a JSON animation document, a second project representation, an interpreter, or another rendering model.

Compilation output is a disposable derived artifact. It can be regenerated from a saved source snapshot and its dependencies; it is never editable project source.

## Processes

The initial deployment is a modular monolith with two processes:

- **API:** authentication, authorization, workspaces, projects, rolling source snapshots, asset metadata, signed URLs, and render-job submission.
- **Renderer:** claims queued jobs, compiles the source snapshot pinned to the job at submission, exports media, stores artifacts, and reports progress.

The renderer is intentionally separate from the API because user-authored source is untrusted and rendering is resource intensive.

```text
Motify web editor
        |
        | HTTPS / JSON
        v
Motify API ----> PostgreSQL
       |             users, workspaces, projects,
       |             source snapshots and job state
       |
       +-----------> S3-compatible object storage
       |             assets and render artifacts
       |
       +-----------> durable render queue ---> isolated renderer
```

## Boundaries

- PostgreSQL holds relational metadata and each project's latest source snapshot, never large binary media.
- S3-compatible storage holds private asset and artifact objects.
- The queue abstracts durable render-job delivery.
- Authentication, storage, and queue providers are implemented behind adapters.
- The backend never imports frontend UI code; frontend integration happens over HTTP and shared contracts.

## Repository layout

- `src`: HTTP API process.
- A renderer worker can be reintroduced as an isolated service when rendering returns.
- `packages/*`: shared contracts, database, provider interfaces, observability, and tooling configuration.
- `drizzle/migrations`: committed database migrations.
- `docs`: operational and integration documentation.

## Development profiles

Local development runs the API and renderer on the developer machine and uses Supabase PostgreSQL and Auth. Hosted and production profiles use the same Supabase project for database and authentication.
