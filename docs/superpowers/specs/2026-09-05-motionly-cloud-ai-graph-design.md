# Motify Cloud AI Graph Design

## Scope

Build the V1 Motify Cloud AI workflow in this backend. Express runs the graph during the request. The frontend remains the only renderer. Do not add queues, workers, generated assets, rendering, or immutable project versions.

This specification resolves one change from `docs/cloud-ai-implementation.md`: V1 uses one project message route, including runtime repair.

## API

`POST /v1/projects/:projectId/messages` is authenticated and CSRF-protected.

```json
{
  "message": "Make the title larger",
  "runtimeError": {
    "message": "Cannot read properties of null"
  },
  "revision": 8
}
```

`runtimeError` and `revision` are optional. The route addresses an existing project. A present `runtimeError` selects `FIX` and requires `revision`. Otherwise the graph classifies the message as `CHAT`, `PLAN`, `CREATE`, or `EDIT`.

Responses are one of:

```json
{ "type": "chat", "response": "..." }
```

```json
{ "type": "plan", "response": "..." }
```

```json
{ "type": "generation", "response": "...", "projectId": "...", "revision": 8 }
```

Every successful outcome answers `200`. Payloads are wrapped in the API's `{ "data": ... }` envelope.

`GET /v1/projects/:projectId` returns the current project metadata, `scenes`, `compositionHtml`, `timelineJs`, and `revision`.

## Project and Audit Persistence

Replace the legacy `project_files` four-file snapshot (`composition.html`, `styles.css`, `timeline.js`, `index.ts`) with the canonical project fields:

```text
title
duration
width
height
fps
scenes JSONB
composition_html
timeline_js
revision
```

CSS belongs inside `compositionHtml`. The database migration backfills existing projects by combining their previous composition HTML and stylesheet before dropping the legacy source storage. Existing `timeline.js` becomes `timelineJs`. The old queue/job/thread/event tables and their HTTP endpoints are removed.

Create lightweight direct-run records:

```text
messages: project_id, user_id, role, content, intent, created_at
generation_runs: project_id, base_revision, saved_revision, intent, model,
selected_skills, repair_attempts, status, input_tokens, output_tokens,
latency_ms, created_at
```

Messages and generation runs are audit/context data, never a queue.

## Graph

The graph uses LangGraph `StateGraph` with dependency injection for the selected model provider, project repository, run repository, skill bundle loader, and validator.

```text
START
  -> classifyIntent
  -> CHAT -> chatResponse -> END
  -> PLAN -> planResponse -> END
  -> CREATE | EDIT | FIX -> loadContext -> selectSkills -> generate
     -> validate -> saveProject -> END
                  invalid -> repair -> validate
                  repair attempts >= 2 -> failed response -> END
```

State contains the authenticated user and workspace IDs, optional project ID, input message, optional runtime error, base revision, intent, current project, recent messages, selected skills, candidate generation, validation errors, repair attempt count, saved revision, and final response.

`PLAN` is non-mutating: it never loads generation skills, generates candidate files, validates, writes project state, or creates a generation run.

`CREATE`, `EDIT`, and `FIX` all target the addressed project. `FIX` also requires the runtime error supplied to the project message route.

## Model Providers and Prompts

The graph remains provider-neutral. Gemini, OpenAI, and Anthropic adapters expose:

- schema-constrained intent output;
- schema-constrained `MotifyGeneration` output;
- plain text chat/plan output.

The provider factory selects the configured official provider and validates that its API key exists. Model calls receive request cancellation and configured token limits.

The graph sends only the message, a bounded recent message history, a short project summary, current project fields, and selected skill content. It never sends secrets, sessions, database credentials, or all skills.

The existing Motify skill loader remains the source of skill content. `core` is always selected; routing is extended for `CREATE`, `EDIT`, and `FIX`.

## Candidate Validation and Repair

`MotifyGeneration` requires title, positive duration/dimensions/fps, scenes, `compositionHtml`, `timelineJs`, and reply. The validator then performs:

1. HTML parsing with a required `<template>`, embedded styles, unique `data-edit` IDs, and no external/dynamic scripts.
2. JavaScript parsing with a required `buildTimeline` export and no imports or unsupported dependencies.
3. Motify safety checks rejecting `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, cookies, browser storage, `window.open`, and dynamic script injection.

Validation does not execute generated JavaScript. A failed candidate is passed with its diagnostics to the repair prompt. At most two repairs are attempted. A final validation failure writes a failed direct-run diagnostic and returns a safe validation error; it never overwrites the project.

## Atomic Overwrite

The graph loads the project revision before generation. On success, one transaction verifies the expected revision, updates all generated fields, increments revision, records the assistant message and completed direct-run diagnostic, and returns the saved revision. A concurrent project update produces `REVISION_CONFLICT` with the current revision and writes no candidate data.

When no project was addressed, one transaction instead verifies workspace write access, inserts the project, records the user message, the assistant message, and the completed run, and returns revision 1. A generation that never validates writes nothing at all, so no empty project is left behind.

## Verification

Tests cover intent routing, PLAN non-mutation, chat non-generation, selected skills, successful generate/validate/overwrite, repair success, repair exhaustion, validation rejections, runtime-error FIX routing, authorization, CSRF, revision conflict, migrations, and provider request mapping. Verification includes focused and full tests, TypeScript build/typecheck, migration generation, and a no-legacy-source/queue reference search.
