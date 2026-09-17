# Motify Cloud AI Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy four-file and queue-based generation backend with a direct LangGraph workflow that safely chats, plans, edits, and repairs an existing Motify project through one project `/messages` API.

**Architecture:** Express authenticates and invokes a dependency-injected LangGraph `StateGraph` synchronously. The graph classifies intent, uses bounded project/message context and selected skills, validates or repairs a structured candidate, then atomically overwrites the current two-field project revision. PostgreSQL stores the current project, recent messages, and direct-run diagnostics; it never stores queued jobs for this workflow.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM/PostgreSQL, Zod 4, LangGraph/ LangChain Core, Gemini/OpenAI/Anthropic SDKs, parse5, Acorn, esbuild, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-motify-cloud-ai-graph-design.md`

## Global Constraints

- Execute the graph directly during the HTTP request; do not create a queue, worker, job polling endpoint, or streaming requirement.
- Use only `POST /v1/projects/:projectId/messages`; `revision` and `runtimeError` are optional input, and `runtimeError` selects `FIX`.
- Persist only `compositionHtml` and `timelineJs`; CSS is embedded in `compositionHtml`.
- `PLAN` and `CHAT` never mutate a project or create a generation run.
- Validate generated source without executing it; reject forbidden browser/network/storage APIs and every import.
- Make project writes atomic with expected-revision checks; report `REVISION_CONFLICT` without partial writes.
- Do not add generated assets, backend rendering, frontend code, immutable versions, or secrets to prompts.
- Keep current uncommitted user changes unstaged; do not create commits unless the user explicitly asks.

---

### Task 1: Install graph and deterministic-validation dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/unit/ai/validation/generation-validator.test.ts`

**Interfaces:**
- Produces `validateMotifyGeneration(generation: MotifyGeneration): ValidationReport` in Task 2.
- Adds `@langchain/langgraph`, `@langchain/core`, `parse5`, and `acorn` as runtime dependencies.

- [x] **Step 1: Write the failing validator contract test**

```ts
it('rejects network APIs and duplicated data-edit identifiers', () => {
  const report = validateMotifyGeneration({
    ...validGeneration,
    compositionHtml: '<template><main data-edit="title"></main><p data-edit="title"></p></template>',
    timelineJs: 'export function buildTimeline() { fetch("https://example.test"); }',
  });

  expect(report.valid).toBe(false);
  expect(report.errors.map((error) => error.code)).toEqual(
    expect.arrayContaining(['DUPLICATE_EDIT_ID', 'FORBIDDEN_API']),
  );
});
```

- [x] **Step 2: Run the test to verify it fails because the validator module is absent**

Run: `npm test -- tests/unit/ai/validation/generation-validator.test.ts`

Expected: FAIL with a missing `generation-validator.js` module.

- [x] **Step 3: Install dependencies**

Run: `npm install @langchain/langgraph @langchain/core parse5 acorn`

Expected: package manifest and lockfile contain exactly those new runtime dependencies.

- [x] **Step 4: Re-run the failing test**

Run: `npm test -- tests/unit/ai/validation/generation-validator.test.ts`

Expected: still FAIL because implementation is not present; dependency installation must not make it pass.

### Task 2: Define AI schemas, provider structured output, and deterministic validation

**Files:**
- Modify: `packages/ai/providers/model.provider.ts`
- Modify: `packages/ai/providers/gemini.provider.ts`
- Modify: `packages/ai/providers/openai.provider.ts`
- Modify: `packages/ai/providers/anthropic.provider.ts`
- Create: `packages/ai/schemas/intent.schema.ts`
- Create: `packages/ai/validation/generation-validator.ts`
- Test: `tests/unit/ai/providers/*.test.ts`
- Test: `tests/unit/ai/validation/generation-validator.test.ts`

**Interfaces:**
- Produces `Intent = 'CHAT' | 'PLAN' | 'CREATE' | 'EDIT' | 'FIX'` and `intentSchema`.
- Produces `StructuredModelRequest<T>` and `MotionModelProvider.structured<T>(request)`.
- Produces `ValidationError`, `ValidationReport`, and `validateMotifyGeneration`.
- Consumes `MotifyGeneration` from `model.provider.ts`.

- [ ] **Step 1: Add failing provider tests for schema-constrained intent output**

```ts
await expect(provider.structured({
  model: 'test-model',
  systemInstructions: 'Classify the Motify request.',
  prompt: 'Please plan a product reveal without changing it.',
  schemaName: 'motify_intent',
  schema: intentSchema,
  limits: { maxOutputTokens: 128, timeoutMs: 5_000 },
})).resolves.toEqual({ intent: 'PLAN' });
```

Assert Gemini sends JSON MIME/schema, OpenAI sends `text.format.type = 'json_schema'`, and Anthropic sends `output_config.format.type = 'json_schema'`.

- [ ] **Step 2: Run provider tests and confirm structured intent fails**

Run: `npm test -- tests/unit/ai/providers`

Expected: FAIL because `structured` and `intentSchema` do not exist.

- [ ] **Step 3: Implement the provider-neutral structured contract**

```ts
export interface StructuredModelRequest<T> {
  model: string;
  systemInstructions: string;
  prompt: string;
  schemaName: string;
  schema: z.ZodType<T>;
  limits: ModelRequestLimits;
  signal?: AbortSignal;
}

export interface MotionModelProvider {
  readonly name: ModelProviderName;
  structured<T>(request: StructuredModelRequest<T>): Promise<T>;
  generate(request: MotionModelRequest): Promise<MotifyGeneration>;
  chat(request: ChatRequest): Promise<string>;
}
```

Each adapter must parse provider JSON, then call `request.schema.safeParse`. Preserve existing normalized error handling and never include raw provider response bodies in errors.

- [ ] **Step 4: Implement the validator without execution**

```ts
export interface ValidationError {
  code: string;
  message: string;
  field: 'compositionHtml' | 'timelineJs' | 'generation';
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
}

export function validateMotifyGeneration(generation: MotifyGeneration): ValidationReport;
```

Use `parse5.parseFragment` to require exactly one `<template>`, embedded `<style>`, and unique `data-edit` values. Use `acorn.parse` with `sourceType: 'module'` to require `export function buildTimeline` and reject every `ImportDeclaration`/dynamic import. Scan source tokens for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `document.cookie`, `localStorage`, `sessionStorage`, `window.open`, and script-element injection. Use `esbuild.transform` with `loader: 'js'`, `format: 'esm'`, and `platform: 'browser'` as the final syntax check only.

- [ ] **Step 5: Run focused tests and strict typecheck**

Run: `npm test -- tests/unit/ai/providers tests/unit/ai/validation/generation-validator.test.ts`

Run: `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck --types node,vitest/globals packages/ai/providers/model.provider.ts packages/ai/providers/gemini.provider.ts packages/ai/providers/openai.provider.ts packages/ai/providers/anthropic.provider.ts packages/ai/schemas/intent.schema.ts packages/ai/validation/generation-validator.ts tests/unit/ai/providers/gemini.test.ts tests/unit/ai/providers/openai.test.ts tests/unit/ai/providers/anthropic.test.ts tests/unit/ai/validation/generation-validator.test.ts`

Expected: all focused tests and the isolated typecheck pass.

### Task 3: Replace legacy project and queue persistence with two-field project state and direct-run audits

**Files:**
- Modify: `packages/database/schema.ts`
- Create: `drizzle/migrations/0008_motify_graph.sql`
- Modify: `src/services/project.service.ts`
- Modify: `src/repositories/project.repository.ts`
- Create: `src/repositories/motion-graph.repository.ts`
- Delete: `src/services/generation.service.ts`
- Delete: `src/repositories/generation.repository.ts`
- Delete: `src/controllers/generation.controller.ts`
- Delete: `src/routes/generation.routes.ts`
- Delete: `packages/generation-tools/source-policy.ts`
- Delete: `src/services/project-preview.service.ts`
- Test: `tests/unit/services/project.service.test.ts`
- Test: `tests/integration/project.repository.test.ts`
- Create: `tests/integration/motion-graph.repository.test.ts`
- Test: `tests/unit/database/schema.test.ts`

**Interfaces:**
- Produces `MotifyProject` with `title`, dimensions, `scenes`, `compositionHtml`, `timelineJs`, and `revision`.
- Produces `GraphProjectRepository.loadWorkspaceForGraph`, `loadForGraph`, `listRecentMessages`, `appendMessage`, `createForGraph`, `overwriteForGraph`, and `recordRun`.
- Removes `ProjectSourceFiles`, source hashes, project preview bundling, queue jobs, generation threads, generation events, and generation API contracts.

**Status:** the schema, the migration, the project service/controller contracts, and `DatabaseMotionGraphRepository` are in place. The repository test is written but only runs with `DATABASE_URL` set, so the generated SQL is still unverified against PostgreSQL. `project_files` and the stale `projects.name`/`source_hash`/`saved_at` columns still exist; migration 0008 only drops the `name` NOT NULL constraint so inserts work, and a later migration should drop the dead columns and table once nothing reads them.

- [ ] **Step 1: Write failing project repository tests for atomic graph overwrite**

```ts
const saved = await repository.overwriteForGraph(projectId, {
  expectedRevision: 3,
  generation: validGeneration,
  userId,
  intent: 'EDIT',
  model: 'test-model',
  selectedSkills: ['core', 'small-edits'],
  repairAttempts: 0,
  latencyMs: 42,
});

expect(saved?.revision).toBe(4);
expect(saved?.compositionHtml).toBe(validGeneration.compositionHtml);
await expect(repository.overwriteForGraph(projectId, { ...input, expectedRevision: 3 })).resolves.toBeNull();
```

Add a migration fixture that represents a legacy project row plus its `composition.html`, `styles.css`, and `timeline.js` rows. Assert that the migrated current project has an inline `<style>`, `timelineJs`, `title`, and empty `scenes`.

- [ ] **Step 2: Run focused persistence tests and confirm failure**

Run: `npm test -- tests/unit/services/project.service.test.ts tests/integration/project.repository.test.ts`

Expected: FAIL because the two-field graph API does not exist.

- [ ] **Step 3: Implement the Drizzle schema and migration**

Define `projects.title`, `projects.scenes`, `projects.compositionHtml`, and `projects.timelineJs`; remove `sourceHash` and `projectFiles`. Define `messages` with `projectId`, `userId`, `role`, `content`, nullable `intent`, and timestamp. Define `generationRuns` with direct-run metadata and no queue status/progress/cancel columns.

Migration requirements:

```sql
ALTER TABLE projects ADD COLUMN title text;
ALTER TABLE projects ADD COLUMN scenes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN composition_html text;
ALTER TABLE projects ADD COLUMN timeline_js text;
```

Backfill `title` from `name`; read `composition.html`, `styles.css`, and `timeline.js` from `project_files`; wrap old markup in `<template>` when needed and inject the stylesheet before `</template>`. Set safe empty timeline/source fallbacks for rows without source data. Only after validating non-null backfill, set `NOT NULL`, drop legacy `project_files`, old generation queue tables, obsolete generation-output/version tables if present, and their foreign keys. Remove `artifacts.generation_id` before dropping `generation_jobs`; retain standalone asset/artifact tables because V1 merely does not use them.

- [x] **Step 4: Implement service/repository access and transaction boundaries**

```ts
export interface GraphProjectRepository {
  loadWorkspaceForGraph(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null>;
  loadForGraph(projectId: string, userId: string): Promise<{ project: MotifyProject; role: WorkspaceRole } | null>;
  listRecentMessages(projectId: string, limit: number): Promise<ChatMessage[]>;
  createForGraph(workspaceId: string, userId: string, input: CreateGraphProjectInput): Promise<MotifyProject | null>;
  overwriteForGraph(projectId: string, input: OverwriteGraphProjectInput): Promise<MotifyProject | null>;
  appendMessage(input: StoredMessageInput): Promise<void>;
  recordRun(input: GenerationRunInput): Promise<void>;
}
```

`overwriteForGraph` must begin a transaction, lock/read the target project, compare `expectedRevision`, update title/dimensions/scenes/HTML/timeline plus revision, append the assistant message, and insert the completed run. Return `null` only for a revision conflict. It must not write a candidate before the revision comparison succeeds. `createForGraph` must verify workspace write access itself, return `null` when the caller may not create, and otherwise insert the project, both messages, and the completed run in one transaction.

- [x] **Step 5: Update project service/controller contracts and remove old source endpoints**

Create/update payloads use the two generated fields. Remove `/source` and `/preview`; `GET /v1/projects/:projectId` becomes the frontend fetch contract. Keep membership and viewer-write protections unchanged.

- [ ] **Step 6: Run persistence verification**

Run: `npm test -- tests/unit/services/project.service.test.ts tests/integration/project.repository.test.ts tests/unit/database/schema.test.ts`

Run: `npm run db:generate`

Expected: focused tests pass and Drizzle reports no unintended schema change beyond the deliberate graph migration.

### Task 4: Build prompts, graph state, nodes, and graph factory

**Files:**
- Create: `packages/ai/prompts/router.prompt.ts`
- Create: `packages/ai/prompts/motion.prompt.ts`
- Create: `packages/ai/prompts/repair.prompt.ts`
- Create: `packages/ai/graph/state.ts`
- Create: `packages/ai/graph/dependencies.ts`
- Create: `packages/ai/graph/motion.graph.ts`
- Create: `packages/ai/graph/nodes/classify-intent.node.ts`
- Create: `packages/ai/graph/nodes/chat.node.ts`
- Create: `packages/ai/graph/nodes/plan.node.ts`
- Create: `packages/ai/graph/nodes/load-context.node.ts`
- Create: `packages/ai/graph/nodes/select-skills.node.ts`
- Create: `packages/ai/graph/nodes/generate.node.ts`
- Create: `packages/ai/graph/nodes/validate.node.ts`
- Create: `packages/ai/graph/nodes/repair.node.ts`
- Create: `packages/ai/graph/nodes/save-project.node.ts`
- Create: `packages/ai/graph/nodes/report-failure.node.ts`
- Modify: `packages/motify-skills/router.ts`
- Test: `tests/unit/ai/graph/motion.graph.test.ts`

**Interfaces:**
- Consumes `MotionModelProvider`, `GraphProjectRepository`, `routeSkills`, `loadSkillBundle`, `validateMotifyGeneration`, and `intentSchema`.
- Produces `createMotionGraph(dependencies): CompiledStateGraph<MotionGraphState>` and `MotionGraphInput`.

- [x] **Step 1: Write failing graph routing tests**

```ts
it('returns a plan without loading context or writing project state', async () => {
  const result = await graph.invoke(input('Plan a 10-second launch animation without changing it.'));

  expect(result.response).toEqual({ type: 'plan', message: '...' });
  expect(repository.loadForGraph).not.toHaveBeenCalled();
  expect(repository.overwriteForGraph).not.toHaveBeenCalled();
});

it('repairs one invalid candidate then atomically overwrites the project', async () => {
  const result = await graph.invoke(input('Make the headline larger.'));

  expect(result.repairAttempts).toBe(1);
  expect(result.response).toMatchObject({ type: 'generation', revision: 8 });
});
```

- [x] **Step 2: Run graph tests and confirm failure**

Run: `npm test -- tests/unit/ai/graph/motion.graph.test.ts`

Expected: FAIL because the graph modules are absent.

- [x] **Step 3: Define explicit graph state and dependencies**

```ts
export interface MotionGraphState {
  userId: string;
  workspaceId: string;
  projectId: string;
  message: string;
  runtimeError?: { message: string };
  requestedRevision?: number;
  intent?: Intent;
  project?: MotifyProject;
  recentMessages: ChatMessage[];
  selectedSkills: RoutedSkill[];
  generation?: MotifyGeneration;
  validationErrors: ValidationError[];
  repairAttempts: number;
  response?: MotionGraphResponse;
}
```

Dependencies are closures injected into every node rather than globals, so tests can use the fake provider and in-memory repository.

- [x] **Step 4: Implement node behavior and conditional edges**

Use `provider.structured(... intentSchema ...)` in `classifyIntent`; bypass classification to `FIX` only when `runtimeError` exists. `chat` and `plan` use provider chat and return immediately. `loadContext` enforces access and loads at most 12 recent messages. `selectSkills` loads bundle v1 and routes `FIX` through edit/repair guidance. `generate` builds the motion prompt from current project fields and selected skill content. `validate` writes diagnostics; `repair` includes original request, current candidate, diagnostics, and selected skills. Route `repairAttempts >= 2` to a failed response and no overwrite. Route valid candidates to `saveProject`, which overwrites the addressed revision.

Graph wiring:

```ts
const graph = new StateGraph(MotionGraphStateSchema)
  .addNode('classifyIntent', classifyIntent)
  .addNode('chat', chat)
  .addNode('plan', plan)
  .addNode('loadContext', loadContext)
  .addNode('selectSkills', selectSkills)
  .addNode('generate', generate)
  .addNode('validate', validate)
  .addNode('repair', repair)
  .addNode('saveProject', saveProject)
  .addNode('reportFailure', reportFailure)
  .addEdge(START, 'classifyIntent')
  .addConditionalEdges('classifyIntent', routeIntent)
  .addConditionalEdges('validate', routeValidation)
  .compile();
```

- [x] **Step 5: Run graph unit tests**

Run: `npm test -- tests/unit/ai/graph/motion.graph.test.ts tests/unit/motify/skill-router.test.ts`

Expected: tests cover CHAT, PLAN, CREATE/EDIT, FIX, repair success, repair exhaustion, selected skills, and no mutation for non-generation paths.

### Task 5: Add one project message endpoint and wire direct graph execution

**Files:**
- Create: `src/services/generation.service.ts`
- Create: `src/controllers/generation.controller.ts`
- Create: `src/routes/generation.routes.ts`
- Create: `packages/ai/providers/factory.ts`
- Create: `src/repositories/motion-graph.repository.ts`
- Modify: `src/server.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Delete: imports/routes/services only used by legacy generation queue and deleted contracts
- Test: `tests/integration/generations.test.ts`
- Test: `tests/unit/services/generation.service.test.ts`
- Test: `tests/unit/ai/providers/factory.test.ts`
- Test: `tests/integration/app.test.ts`

**Interfaces:**
- Produces `GenerationService.sendMessage(userId, projectId, input): Promise<MessageResult>`.
- Consumes the compiled graph and validates request body `{ message, runtimeError?, revision? }`.

- [x] **Step 1: Write failing route tests**

```ts
const response = await authenticated(request(app))
  .post(`/v1/projects/${projectId}/messages`)
  .send({ message: 'Make the headline larger.', revision: 7 });

expect(response.status).toBe(200);
expect(response.body.data).toMatchObject({
  type: 'generation',
  response: 'Updated the headline.',
  projectId,
  revision: 8,
});
expect(generations.sendMessage).toHaveBeenCalledWith(user.id, projectId, {
  message: 'Make the headline larger.',
  revision: 7,
});
```

```ts
await authenticated(request(app))
  .post(`/v1/projects/${projectId}/messages`)
  .send({ message: 'Fix it', runtimeError: { message: 'null root' } })
  .expect(400);
```

The second test proves a FIX request requires `revision`; `projectId` comes from the route.

- [x] **Step 2: Run the route test and confirm failure**

Run: `npm test -- tests/integration/generations.test.ts`

Expected: FAIL with route not found or missing controller module.

- [x] **Step 3: Implement service, controller, and route**

```ts
const messageSchema = z.strictObject({
  message: z.string().trim().min(1).max(20_000),
  runtimeError: z.strictObject({ message: z.string().trim().min(1).max(4_000) }).optional(),
  revision: z.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (value.runtimeError && value.revision === undefined) {
    context.addIssue({ code: 'custom', path: ['revision'], message: 'revision is required for runtime repair.' });
  }
});
```

Mount `POST /v1/projects/:projectId/messages` after authentication, with `requireCsrf` and a per-user rate limit. The service checks project write access before invoking the graph, so an unauthorized caller never reaches the model. Build one configured provider factory from `AI_PROVIDER`, `AI_MODEL`, and the matching API key. Pass it to `createMotionGraph`; do not instantiate a model inside a route handler.

- [x] **Step 4: Remove legacy queue startup wiring and deleted contract imports**

Remove the queue `GenerationService`, generation repository, queue endpoints, and the `openApiDocument` import/endpoint that depended on deleted `packages/contracts`. Preserve unrelated auth, workspace, project, standalone artifact, and standalone asset APIs.

- [x] **Step 5: Run HTTP integration tests**

Run: `npm test -- tests/integration/app.test.ts`

Expected: authenticated/CSRF project-message calls work; unauthenticated calls return 401; missing CSRF returns 403; successful chat, plan, and generation results return 200 with assistant text in `response`; a runtime error without `revision` returns 400.

### Task 6: Remove legacy references and verify the MVP end-to-end

**Files:**
- Modify/Delete: legacy generation, source-preview, old contract, and old project-source tests that no longer match the approved architecture
- Modify: `tests/e2e/projects.live.test.ts`
- Create: `tests/integration/generation-graph.test.ts`
- Modify: `docs/api.md`, `docs/cloud-ai-implementation.md`

**Interfaces:**
- Consumes the complete graph/API/persistence implementation from Tasks 1–5.
- Produces evidence for every MVP item in the approved specification.

- [ ] **Step 1: Apply migration to an isolated test database and run the migration test**

Run: `npm run db:migrate`

Run: `npm test -- tests/integration/motion-graph.repository.test.ts`

Expected: the Task 3 migration test passes and `project_files` is absent.

- [ ] **Step 2: Update tests to remove queue and four-file assumptions**

Replace tests of the queued `/generations` job API, events, cancellation, source bundles, and preview bundling with tests of the direct project `/messages` route, current project reads, direct-run records, repair limits, and revision conflicts. Delete tests only when their corresponding legacy production capability is removed.

- [ ] **Step 3: Run complete verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `git diff --check`

Run: `rg -n "generation_jobs|generation_threads|generation_events|project_files|PROJECT_SOURCE_PATHS|GEMINI_MODEL|/source|/preview" src packages tests --glob '!packages/motify-runtime/reference/**'`

Expected: all tests/typecheck/build pass; the search returns no active legacy queue/four-file API implementation references; any migration-history hits are expected and documented.

- [x] **Step 4: Manually exercise the direct graph boundary with the fake provider**

Invoke the compiled graph in an integration test with a fake provider and a real transaction-capable repository. Confirm CHAT/PLAN do not alter `projects`, a valid EDIT increments revision once, a malformed output is repaired at most twice, and a stale expected revision yields `REVISION_CONFLICT` without changing persisted fields.

Covered by graph and service tests that drive `GenerationService` and the compiled graph against test repositories: a valid generation edits the addressed project and answers 200, a stale revision answers 409 without recording a run, and CHAT/PLAN requests write nothing. The repair-limit path is covered by graph unit tests, and the PostgreSQL repository itself is covered by `tests/integration/motion-graph.repository.test.ts` whenever `DATABASE_URL` is set.
