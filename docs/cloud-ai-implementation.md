# Motify Cloud AI Implementation Plan

**File:** `cloud-ai-implementation.md`
**Goal:** Build a cloud AI generation system for Motify using **Express + TypeScript + LangGraph**, while keeping all motion rendering on the frontend with the existing **GSAP + `createDynamicComposition()`** runtime.

---

## 1. Objective

The cloud AI system should allow users to chat with Motify and create or edit motion graphics without generating files for normal conversation.

The system must support:

- Normal chat without motion generation.
- Creating new Motify compositions.
- Editing an existing composition.
- Fixing broken AI-generated composition files.
- Loading only relevant AI skills.
- Overwriting the existing project only after a generation passes validation.
- Keeping backend generation separate from frontend rendering.
- Returning the updated project data for the frontend to render with GSAP.

The backend **must not render or preview the composition**.

For the MVP, Express runs the LangGraph generation flow directly during the request. Do not add a queue or generation worker yet; those are future scaling concerns.

---

# 2. Existing Motify Runtime Contract

The current Motify frontend should remain the renderer.

AI-generated projects should continue using:

```text
compositionHtml
timelineJs
```

The frontend already supports:

```ts
createDynamicComposition(
  compositionHtml,
  timelineJs,
  {
    id,
    title,
    duration,
    width,
    height,
    fps,
    scenes
  }
);
```

Therefore the AI backend should generate and save:

```ts
interface MotifyGeneration {
  title: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  scenes: SceneDefinition[];

  compositionHtml: string;
  timelineJs: string;

  reply: string;
}
```

Do not create another motion representation such as:

```text
scene.json
React components
package.json
index.ts
styles.css
```

for AI-generated projects.

CSS should stay inside `compositionHtml`.

---

# 3. High-Level Architecture

```text
                         USER
                          |
                          v
                    Motify Frontend
                          |
                          | POST message
                          v
                    Express Backend
                          |
                          v
                     LangGraph
                          |
              +-----------+-----------+
              |                       |
            CHAT               CREATE / EDIT / FIX
              |                       |
              v                       v
         Chat Response           Load Context
                                      |
                           +----------+----------+
                           |          |          |
                           v          v          v
                              Project + History
                                      |
                                      v
                                Select Skills
                                      |
                                      v
                                 Generate
                                      |
                                      v
                                  Validate
                                /          \
                             valid        invalid
                               |             |
                               |             v
                               |           Repair
                               |             |
                               +------<------+
                                      |
                                      v
                              Save Project
                                      |
                                      v
                            Return Project Result
                                      |
                                      v
                               Motify Frontend
                                      |
                                      v
                              GET Project
                                      |
                                      v
                         createDynamicComposition()
                                      |
                                      v
                                     GSAP
```

---

# 4. Folder Structure

Recommended backend structure:

```text
backend/
|
├── packages/
│   |
│   ├── ai/
│   │   |
│   │   ├── graph/
│   │   │   ├── motion.graph.ts
│   │   │   ├── state.ts
│   │   │   └── nodes/
│   │   │       ├── classify-intent.node.ts
│   │   │       ├── load-context.node.ts
│   │   │       ├── select-skills.node.ts
│   │   │       ├── chat.node.ts
│   │   │       ├── generate.node.ts
│   │   │       ├── validate.node.ts
│   │   │       ├── repair.node.ts
│   │   │       └── save.node.ts
│   │   |
│   │   ├── providers/
│   │   │   ├── model.provider.ts
│   │   │   ├── anthropic.provider.ts
│   │   │   ├── gemini.provider.ts
│   │   │   └── openai.provider.ts
│   │   |
│   │   ├── prompts/
│   │   │   ├── router.prompt.ts
│   │   │   ├── motion.prompt.ts
│   │   │   └── repair.prompt.ts
│   │   |
│   │   └── schemas/
│   │       ├── generation.schema.ts
│   │       └── intent.schema.ts
│   |
│   ├── motify-skills/
│   │   ├── registry.ts
│   │   ├── loader.ts
│   │   |
│   │   ├── motify-core/
│   │   │   └── SKILL.md
│   │   |
│   │   ├── kinetic-typography/
│   │   │   └── SKILL.md
│   │   |
│   │   ├── product-showcase/
│   │   │   └── SKILL.md
│   │   |
│   │   ├── data-visualization/
│   │   │   └── SKILL.md
│   │   |
│   │   └── repair/
│   │       └── SKILL.md
│   |
```

---

# 5. LangGraph State

Create one shared graph state.

```ts
interface MotionGraphState {
  userId: string;
  workspaceId: string;
  projectId?: string;

  message: string;

  intent?:
    | "CHAT"
    | "CREATE"
    | "EDIT"
    | "FIX"
    | "PLAN";

  project?: MotifyProjectContext;

  selectedSkills?: string[];

  generation?: MotifyGeneration;

  validationErrors?: ValidationError[];

  repairAttempts: number;

  savedProjectRevision?: number;

  response?: {
    type: "chat" | "plan" | "generation";
    message: string;
    projectId?: string;
    revision?: number;
  };
}
```

---

# 7. LangGraph Workflow

Recommended graph:

```text
START
  |
  v
classifyIntent
  |
  +---- CHAT --------------------> chatResponse ----> END
  |
  +---- PLAN --------------------> planResponse ----> END
  |
  +---- CREATE / EDIT / FIX -----> loadContext
                                      |
                                      v
                                selectSkills
                                      |
                                      v
                                   generate
                                      |
                                      v
                                   validate
                                  /       \
                               valid     invalid
                                 |          |
                                 |          v
                                 |        repair
                                 |          |
                                 |          v
                                 |       validate
                                 |          |
                                 +----------+
                                      |
                                      v
                             overwriteProject
                                      |
                                      v
                                     END
```

---

# 7. Node Responsibilities

## 7.1 `classifyIntent`

Purpose:

Prevent normal messages from triggering expensive generation.

Input:

```text
hello
thanks
what can Motify do?
make a logo animation
make the title larger
fix this animation
plan a 15-second product launch animation
```

Output:

```json
{
  "intent": "CHAT"
}
```

or:

```json
{
  "intent": "CREATE"
}
```

Allowed values:

```text
CHAT
CREATE
EDIT
FIX
PLAN
```

Use structured output.

`PLAN` is selected only when the user explicitly asks Motify to plan, outline, storyboard, or propose a motion concept without changing the project. It returns a text response and does not run generation or save project data.

Zod example:

```ts
const IntentSchema = z.object({
  intent: z.enum([
    "CHAT",
    "CREATE",
    "EDIT",
    "FIX",
    "PLAN"
  ])
});
```

---

## 7.2 `planResponse`

Only run when the user explicitly asks for a plan, outline, storyboard, or motion concept before generation.

The node returns a concise text plan. It must not generate composition files, validate source, or update the project.

---

## 8.2 `loadContext`

Only run for:

```text
CREATE
EDIT
FIX
```

Load:

- Current project.
- Current project state and revision.
- `compositionHtml`.
- `timelineJs`.
- Project metadata.
- Project scenes.
- Relevant conversation history.

For `CREATE`, existing code may be empty.

For `EDIT`, the current project is required.

For `FIX`, the current project plus error information is required.

---

## 8.3 `selectSkills`

Always include:

```text
motify-core
```

Then load additional skills based on the request.

Examples:

```text
"Create animated typography"

motify-core
kinetic-typography
```

```text
"Create an animated revenue chart"

motify-core
data-visualization
```

Do not load every skill into every prompt.

---

## 8.4 `generate`

The generation node receives:

```text
User request
+
Current Motify files
+
Current project metadata
+
Selected skill instructions
```

Expected structured output:

```json
{
  "title": "Product Reveal",
  "duration": 12,
  "width": 1920,
  "height": 1080,
  "fps": 60,

  "scenes": [
    {
      "id": "scene-01",
      "label": "Intro",
      "start": 0,
      "duration": 4,
      "accent": "#6366f1"
    }
  ],

  "compositionHtml": "<template>...</template>",

  "timelineJs": "export function buildTimeline(context) {...}",

  "reply": "Created a product reveal with a kinetic logo intro."
}
```

---

# 8. AI Generation Rules

The `motify-core` skill should enforce these rules.

## Required output

AI may generate only:

```text
metadata
compositionHtml
timelineJs
reply
```

Do not allow it to generate:

```text
package.json
index.ts
React files
Svelte files
npm dependencies
external scripts
arbitrary backend code
```

---

## HTML rules

`compositionHtml` should:

- Contain a `<template>`.
- Include scoped CSS.
- Use stable `data-edit` IDs.
- Avoid remote scripts.
- Avoid unknown external dependencies.

Example:

```html
<template id="motify-composition-template">
  <style>
    .hero {
      position: absolute;
      inset: 0;
    }
  </style>

  <main class="hero" data-edit="stage">
    <h1 data-edit="title">
      Motify
    </h1>
  </main>
</template>
```

---

## Timeline rules

`timelineJs` should expose:

```js
export function buildTimeline(context) {
  const {
    root,
    timeline,
    register
  } = context;

  // ...
}
```

AI must use:

```text
root
timeline
register
```

Do not allow a separate GSAP timeline that bypasses the Motify-owned timeline.

---

# 13. Validation Pipeline

No backend browser preview is required.

Use lightweight deterministic validation.

```text
AI Generation
     |
     v
Zod Validation
     |
     v
HTML Validation
     |
     v
JavaScript Validation
     |
     v
Motify Validation
```

---

## 13.1 Zod validation

Check required fields.

```ts
const GenerationSchema = z.object({
  title: z.string().min(1),

  duration: z.number()
    .min(1)
    .max(60),

  width: z.number().positive(),
  height: z.number().positive(),
  fps: z.number().positive(),

  scenes: z.array(SceneSchema),

  compositionHtml: z.string().min(50),
  timelineJs: z.string().min(20),

  reply: z.string()
});
```

---

## 13.2 HTML validation

Use:

```text
parse5
```

Check:

- HTML parses.
- `<template>` exists.
- `data-edit` IDs are unique.
- Unsupported tags are rejected if necessary.
- External scripts are rejected.

---

## 13.3 JavaScript validation

Use:

```text
Acorn
esbuild
```

Check:

- Script parses.
- `buildTimeline` exists.
- No malformed JavaScript.
- No unsupported imports.
- No external package dependencies.

---

## 13.4 Motify-specific validation

Build a custom validator.

Example rules:

```text
compositionHtml exists
timelineJs exists
template exists
buildTimeline exists
duration <= limit
data-edit values unique
no fetch()
no XMLHttpRequest
no WebSocket
no document.cookie
no localStorage
no sessionStorage
no dynamic external scripts
```

---

# 14. Repair Workflow

If validation fails:

```text
validation errors
      |
      v
repair node
      |
      v
new compositionHtml / timelineJs
      |
      v
validate again
```

Use:

```text
MAX_REPAIR_ATTEMPTS = 2
```

or maximum:

```text
3
```

Do not retry forever.

Repair prompt should include:

```text
Original user request
Current files
Validation errors
Relevant selected skills
```

The repair model should fix the current generation instead of redesigning the project unnecessarily.

---

# 15. Frontend Runtime Error Repair

Some errors cannot be detected without actually running the composition.

Since rendering happens only on the frontend, capture errors there.

Example:

```ts
try {
  createDynamicComposition(...);
} catch (error) {
  reportRuntimeError(error);
}
```

The frontend can send:

```http
POST /v1/projects/:projectId/messages
```

```json
{
  "message": "The preview crashed after my last edit.",
  "revision": 7,
  "runtimeError": {
    "message": "Cannot read properties of null"
  }
}
```

Then LangGraph starts with:

```text
intent = FIX
```

and loads:

```text
current project
runtime error
repair skill
```

After the repaired output passes validation, the backend overwrites the current project and increments its revision.

---

# 16. MVP Project Persistence

For the MVP, do not create immutable project versions. A successful CREATE, EDIT, or FIX generation overwrites the existing project.

The backend must validate the complete candidate before writing anything. Save the project metadata, `compositionHtml`, and `timelineJs` atomically, then increment the project revision.

```text
Load current project revision
          |
          v
Generate and validate candidate
          |
          v
Atomically overwrite project
          |
          v
Increment revision
```

Reject the save with a revision conflict if the project changed while generation was running. Immutable version history may be added later when the product needs restoration or audit history.

---

# 17. Database Schema

## `projects`

```text
id
workspace_id
user_id

title
duration
width
height
fps
scenes JSONB

composition_html TEXT
timeline_js TEXT

revision
created_at
updated_at
```

---

## `messages`

```text
id
project_id
user_id

role
content
intent

created_at
```

---

## `generation_runs`

Recommended for debugging AI behavior:

```text
id
project_id
base_revision
saved_revision

intent
model
selected_skills

repair_attempts
status

input_tokens
output_tokens
latency_ms

created_at
```

Do not store secrets or sensitive model credentials.

---

# 18. API Design

## Send message

```http
POST /v1/projects/:projectId/messages
```

Body:

```json
{
  "message": "Make the title larger and animate my logo",
  "revision": 8
}
```

Only `message` is required. The route addresses an existing project; send `revision` when generating against a known revision.

The frontend should not send all project files every time.

The backend should load the current project itself.

Response for chat:

```json
{
  "data": {
    "type": "chat",
    "response": "Hi! What would you like to create?"
  }
}
```

Response for generation:

```json
{
  "data": {
    "type": "generation",
    "response": "Updated the title and added a logo reveal.",
    "projectId": "proj_123",
    "revision": 8
  }
}
```

Every successful outcome answers `200`.

---

## Get project

```http
GET /v1/projects/:projectId
```

Response:

```json
{
  "id": "proj_123",
  "title": "Product Reveal",
  "duration": 12,
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "scenes": [],
  "compositionHtml": "...",
  "timelineJs": "...",
  "revision": 8
}
```

---

## Runtime error repair

The same endpoint handles repair; a reported runtime error selects `FIX`.

```http
POST /v1/projects/:projectId/messages
```

Body:

```json
{
  "message": "The preview crashed after my last edit.",
  "revision": 8,
  "runtimeError": {
    "message": "Cannot read properties of null"
  }
}
```

`runtimeError` requires `revision`; the project ID comes from the route.

---

# 19. LangGraph Example

Conceptual structure:

```ts
const graph = new StateGraph<MotionGraphState>();

graph.addNode(
  "classifyIntent",
  classifyIntentNode
);

graph.addNode(
  "chat",
  chatNode
);

graph.addNode(
  "plan",
  planNode
);

graph.addNode(
  "loadContext",
  loadContextNode
);

graph.addNode(
  "selectSkills",
  selectSkillsNode
);

graph.addNode(
  "generate",
  generateNode
);

graph.addNode(
  "validate",
  validateNode
);

graph.addNode(
  "repair",
  repairNode
);

graph.addNode(
  "overwriteProject",
  overwriteProjectNode
);
```

Routing:

```ts
graph.addConditionalEdges(
  "classifyIntent",
  state => state.intent,
  {
    CHAT: "chat",
    PLAN: "plan",
    CREATE: "loadContext",
    EDIT: "loadContext",
    FIX: "loadContext"
  }
);
```

Validation routing:

```ts
graph.addConditionalEdges(
  "validate",
  state => {
    if (
      !state.validationErrors?.length
    ) {
      return "overwriteProject";
    }

    if (
      state.repairAttempts >= 2
    ) {
      return END;
    }

    return "repair";
  }
);
```

---

# 20. Skills System

Skill structure:

```text
skills/
|
├── motify-core/
│   └── SKILL.md
|
├── kinetic-typography/
│   └── SKILL.md
|
├── product-showcase/
│   └── SKILL.md
|
├── data-visualization/
│   └── SKILL.md
|
└── repair/
    └── SKILL.md
```

Registry example:

```ts
export const skillRegistry = {
  "motify-core": {
    description:
      "Core Motify HTML, GSAP, timeline and data-edit rules.",
    path:
      "skills/motify-core/SKILL.md"
  },

  "kinetic-typography": {
    description:
      "Animated text, word reveals and kinetic typography.",
    path:
      "skills/kinetic-typography/SKILL.md"
  }
};
```

The selector sees only:

```text
skill name
description
```

Then the backend loads full `SKILL.md` content only for selected skills.

This reduces prompt size and token cost.

---

# 21. Model Provider Abstraction

Do not couple LangGraph directly to one model vendor.

Create:

```ts
interface MotionModelProvider {
  generate(
    request: MotionModelRequest
  ): Promise<MotifyGeneration>;

  chat(
    request: ChatRequest
  ): Promise<string>;
}
```

Providers:

```text
Anthropic
Gemini
OpenAI
```

This allows model comparison without changing graph logic.

---

# 22. Token Optimization

Use these rules:

### Do not send all conversation messages.

Send:

```text
recent conversation
+
short project summary
```

---

### Do not send every skill.

Load only selected skills.

---

### Avoid regenerating unchanged code when possible.

For a future optimization, add patch-based editing.

Example:

```json
{
  "target": "compositionHtml",
  "operation": "replace",
  "description": "Increase title font size to 160px"
}
```

For the first implementation, full `compositionHtml + timelineJs` replacement is simpler and acceptable.

---

# 23. Security Rules

AI-generated JavaScript is untrusted.

Backend validation should reject:

```text
fetch()
XMLHttpRequest
WebSocket
EventSource
document.cookie
localStorage
sessionStorage
window.open
dynamic script injection
external package imports
```

Frontend runtime should remain isolated from authentication credentials.

Generated compositions must never receive:

```text
Supabase service role key
database credentials
API tokens
user session tokens
```

---

# 25. MVP Definition

A good first cloud AI MVP is complete when:

- [ ] User sends a message.
- [ ] `"hello"` returns chat only.
- [ ] Motion requests trigger LangGraph.
- [ ] LangGraph loads current project files.
- [ ] AI generates valid `compositionHtml`.
- [ ] AI generates valid `timelineJs`.
- [ ] Zod validates output.
- [ ] HTML validator runs.
- [ ] JavaScript validator runs.
- [ ] Motify validator runs.
- [ ] Broken output is automatically repaired.
- [ ] Successful output overwrites the current project atomically.
- [ ] The project revision increments after a successful overwrite.
- [ ] Frontend fetches the updated project.
- [ ] Frontend renders it with `createDynamicComposition()`.
- [ ] AI skills are dynamically selected.
- [ ] Runtime errors can be sent back for repair.

---

# 26. Recommended Implementation Order

Use this exact order:

```text
1. Express AI endpoint
        |
2. LangGraph intent routing
        |
3. CREATE generation
        |
4. EDIT generation
        |
5. Atomic PostgreSQL project overwrite + revision check
        |
6. Frontend fetch + render project
        |
7. Static validation
        |
8. Repair loop
        |
9. Skills
        |
10. Runtime error repair
        |
11. Future queue / worker scaling (not part of MVP)
```

---

# 27. Final Recommended Architecture

```text
                          FRONTEND
                    Svelte + TypeScript
                           + GSAP
                              |
                              |
                              v
                        EXPRESS API
                              |
                              v
                         LANGGRAPH
                              |
       +----------------------+
       |                      |
       v                      v
 Intent Router          Project Context
       |                      |
       +----------------------+
                              |
                              v
                        Skill Selector
                              |
                              v
                         Motion Agent
                              |
                 +------------+------------+
                 |                         |
                 v                         v
          compositionHtml             timelineJs
                 |                         |
                 +------------+------------+
                              |
                              v
                           Validator
                          /         \
                       valid       invalid
                         |            |
                         |            v
                         |          Repair
                         |            |
                         +------<-----+
                              |
                              v
                    Overwrite Project
                              |
                              v
                          PostgreSQL
                              |
                              v
                           Frontend
                              |
                              v
                  createDynamicComposition()
                              |
                              v
                             GSAP
```

The core rule is:

> **LangGraph handles reasoning and generation. Express handles the `/v1` API and runs generation directly for the MVP. PostgreSQL stores the current project state. The frontend remains the only Motify renderer. Assets, queues, and worker scaling are deferred.**
