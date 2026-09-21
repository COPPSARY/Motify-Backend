# Security

## Trust boundaries

User-authored TypeScript is untrusted. It must never be compiled or executed in the API process. The renderer uses an isolated, disposable environment with CPU, memory, process, filesystem, and time limits.

Render jobs must not access host credentials or internal networks. Each job mounts only the pinned project source and explicitly referenced assets, and may use only approved dependencies or a locked dependency manifest.

## Tenant isolation

Every project, asset, and render operation is authorized at the workspace boundary. Membership roles are `owner`, `editor`, and `viewer`; cross-workspace reads and mutations must be denied by both service-layer authorization and database policies.

## Data protection

- Store asset and render binaries in private object-storage buckets, not PostgreSQL.
- Issue short-lived authenticated upload sessions. The local V1 adapter streams downloads through authorized API routes; a future remote-storage adapter may use short-lived signed URLs.
- Validate asset size, SHA-256, filename extension, MIME type, and content before use; the completion step re-verifies stored bytes so partial/crash-left uploads cannot become `READY`.
- Audio duration and tags are read with a pure-JavaScript parser; the API never passes uploaded audio to a native decoder or `ffmpeg`, and never sends audio bytes to a model provider.
- System music-library tracks are written only by the developer seed script with the service-role key; the API exposes them read-only, and workspace tracks stay scoped to their workspace.
- Never send database credentials, storage credentials, service-role keys, or authentication secrets to the browser.
- Redact secrets and internal exception details from responses and logs.

## Authentication sessions

- Supabase authenticates email/password and Google identities; Express owns the application session.
- The browser receives only a random opaque session cookie marked `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- PostgreSQL stores a SHA-256 hash of that cookie. Supabase access and refresh tokens are encrypted with AES-256-GCM using `SESSION_ENCRYPTION_KEY`.
- Cookie-authenticated mutations require a session-bound CSRF token.
- Google login uses PKCE and a hashed, single-use attempt identifier with a ten-minute expiry.
- Credentialed CORS and OAuth redirects are restricted to configured frontend origins.

## Operational controls

- Use request-size limits and rate limits for public endpoints. Authentication is IP-limited; generation mutations are additionally user-limited, and multi-instance deployments must use a shared edge/store-backed limiter.
- Use safe machine-readable error codes and user-safe error messages.
- Track attempts, timeouts, cancellation, retries, and cleanup for render jobs.
- Record security-relevant audit events when team collaboration is introduced.
- Test that users cannot access another workspace's resources.

## Cloud generation controls

- When a generation worker is deployed, model keys must exist only in that worker environment and must never be mounted into renderer containers.
- The coordinator exposes enum-constrained source tools; the model receives no shell or arbitrary filesystem tool.
- Renderer containers run non-root with no network, read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, bounded CPU/memory/PIDs/time, and one staged workspace mount.
- Source policy rejects traversal, symlinks, remote imports, Node/process APIs, `.motion`, JSON animation DSLs, and alternate renderers.
- Tool-call audits persist only tool names, paths, counts, byte sizes, outcomes, durations, and stable error codes; they never persist source-edit contents or prompts.
- Local development object/workspace roots (`data/` and `tmp/`) are ignored by Git; production deployments must place them on access-controlled volumes with retention and backup policies appropriate to their different lifetimes.
- Publication is conditional on the pinned project version/revision, so concurrent work is retained.
- Prompt content, project files, raw provider errors, keys, and container internals are not written to normal application logs.
