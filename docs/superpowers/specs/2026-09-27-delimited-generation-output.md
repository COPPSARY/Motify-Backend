# Delimited-tag output for motion generation

Date: 2026-09-27

## Problem

`generate()` and `repair()` currently ask the model for one JSON object
(`motifyGenerationSchema`: `title`, `duration`, `width`, `height`, `fps`,
`scenes`, `compositionHtml`, `timelineJs`, `reply`), enforced via each
provider's native structured/JSON-schema output mode
(`output_config.format` on Anthropic, `response_format`/`responseFormat`
on OpenAI/OpenRouter, `responseJsonSchema` on Gemini).

`compositionHtml` and `timelineJs` are large blocks of HTML/JS text that
have to be embedded as JSON string values. Every quote, backtick,
newline, and template literal inside that code has to be escaped
correctly inside a single up-to-32k-token response, and one bad escape
invalidates the entire response, not just the field that broke.

## Goals

- Stop asking the model to JSON-escape large HTML/JS bodies.
- Keep the existing validation/repair contract: `provider.generate()`
  still returns `ModelGenerationResult` or throws
  `ModelProviderError('PROVIDER_OUTPUT_INVALID', ...)`; the graph
  (`generate` → `validate` → `repair`) does not change.
- Keep `motifyGenerationSchema` as the single source of truth for what a
  valid generation looks like.
- Touch `structured()` and `chat()` as little as possible — they have no
  large-code-in-JSON problem and keep their current JSON-schema modes.

## Non-goals

- No native tool-calling. Rejected: it requires separate tool-call wiring
  per provider (Anthropic `tool_use`, OpenAI functions, Gemini
  function-calling, OpenRouter tools) for a problem that a single
  plain-text format solves with far less code, matching the complexity
  level of comparable tools (bolt.diy uses one plain-text completion and
  a single shared parser, no per-provider structured/tool APIs, for the
  same "large code in the response" problem).
- No change to the LangGraph node structure, `MotionGraphState`, or the
  `MotionModelProvider` interface shape.
- No streaming/incremental UI updates in this pass. The parser is written
  against a complete response, same as today.

## Design

### Output format

The model is asked to emit five fixed, always-present tags instead of one
JSON object:

```
<motify:metadata>{"title":"...","duration":12,"width":1920,"height":1080,"fps":30}</motify:metadata>
<motify:scenes>[{"id":"intro","label":"Intro","start":0,"duration":4,"accent":"#7c3aed","tracks":[...]}]</motify:scenes>
<motify:html>
<main class="composition">...</main>
</motify:html>
<motify:js>
timeline.from("#intro h1", { opacity: 0, y: 60, duration: 0.8 });
</motify:js>
<motify:reply>
Two or three short plain sentences.
</motify:reply>
```

`metadata` and `scenes` stay small, structured, and JSON-parseable — no
raw code ever lands inside them, so escaping stays trivial. `html`,
`js`, and `reply` are read as raw text between their tags; the model
never encodes them as JSON strings.

Tags are fixed and known in advance (there are always exactly five, in
this set), unlike bolt's arbitrary per-file tags — this keeps the parser
a fixed set of lookups, not a general-purpose tag/action interpreter.

### Prompt changes

`buildMotionSystemPrompt` (`packages/ai/prompts/motion.prompt.ts`)
currently states the "USER-FACING REPLY CONTRACT" section and relies on
`withSchemaPrompt` (called per-provider) to state the JSON schema. This
changes to:

- `buildMotionSystemPrompt` states the five-tag output contract directly
  (replacing the JSON-schema framing), since it is shared by `generate`
  and `repair` (`buildRepairSystemPrompt` wraps it).
- `withSchemaPrompt`, `motifyGenerationJsonSchema`, and
  `anthropicCompatibleSchema` are no longer used by `generate()`. They
  stay in place for `structured()`, which is unaffected.

### Parsing

A new function in `packages/ai/providers/model.provider.ts`,
`parseMotifyGenerationTags(text: string): MotifyGeneration`, replaces
`parseMotifyGeneration` as what each provider's `generate()` calls:

- Locates each of the five `<motify:NAME>...</motify:NAME>` tags by
  `indexOf`, in any order, exactly once each.
- `JSON.parse`s the `metadata` and `scenes` tag contents; other fields
  merge into the assembled object under their tag name (`html` →
  `compositionHtml`, `js` → `timelineJs`).
- Trims each raw-text field the same way `compositionHtml`/`timelineJs`
  are trimmed today (no markdown-fence stripping needed since the model
  is not asked to fence them, but the parser tolerates an optional
  ` ```html `/` ```js ` fence the way `unfenced()` does today, since
  models sometimes add one anyway).
- Missing tag, duplicate tag, unparseable `metadata`/`scenes` JSON, or a
  field that fails `motifyGenerationSchema` after assembly all throw the
  same `ModelProviderError('PROVIDER_OUTPUT_INVALID', ...)` as today,
  with a `cause` naming which tag/field failed — this is what routes into
  `repair` via the existing `routeValidation` logic. No new error type,
  no new graph edge.
- The final assembled object is validated once against the full
  `motifyGenerationSchema` (same schema as today; unchanged), so
  correctness guarantees are identical to the JSON-object path.

### Per-provider changes

Each provider's `generate()` drops its schema-forcing config and becomes
a plain-text call (structurally closer to `chat()`):

- **Anthropic** (`anthropic.provider.ts`): remove `output_config.format`;
  keep `effortFor`/`thinkingFor`. Call `parseMotifyGenerationTags` on
  `textOf(message)` instead of `parseMotifyGeneration(unfenced(...))`.
- **OpenAI-compatible** (`openai.provider.ts`): remove `response_format`.
- **Gemini** (`gemini.provider.ts`): remove `responseMimeType`/
  `responseJsonSchema`; call `requireModelText(response.text)` into the
  new parser.
- **OpenRouter** (`openrouter.provider.ts`): remove `responseFormat`/
  `REQUIRE_SCHEMA_SUPPORT` from `generate()` (a plain-text request can
  route to any provider OpenRouter has, which is a secondary benefit —
  today's `requireParameters: true` restricts routing to
  schema-supporting providers only for this call).
  `structured()` keeps `REQUIRE_SCHEMA_SUPPORT` and `responseFormat`
  unchanged, since it's untouched by this spec.

`repair.node.ts` and `validate.node.ts` need no changes: both interact
with `provider.generate()`/the assembled `MotifyGeneration` only, never
with the wire format.

### Testing

- `provider-contract.test.ts` and each provider's own test currently
  assert against the JSON-schema path for `generate()`. These are
  rewritten to mock a plain-text response containing the five tags and
  assert the parsed `MotifyGeneration` matches, plus cases for: missing
  tag, duplicate tag, malformed `metadata`/`scenes` JSON, and a
  `motifyGenerationSchema` violation post-assembly — each asserting
  `PROVIDER_OUTPUT_INVALID`.
- A new unit test file for `parseMotifyGenerationTags` itself (tag
  extraction, ordering-independence, optional code-fence tolerance).
- `motion.graph.test.ts`/`chat.node.test.ts` are unaffected: they mock
  `provider.generate()` at the boundary and never see the wire format.

## Risks

- Losing provider-level enforcement on `metadata`/`scenes`: today
  Anthropic/OpenAI/OpenRouter constrain generation toward the schema
  before the model even finishes; after this change, `metadata`/`scenes`
  rely on prompt instructions + post-parse Zod validation + the existing
  repair loop, same as `compositionHtml`/`timelineJs` already do today.
  This is a real trade — mitigated by `metadata`/`scenes` being small,
  simple, low-variance JSON that models produce reliably even
  unconstrained (unlike the current large-code-in-JSON case this spec
  exists to fix).
- A model that ignores the tag format entirely fails the same way an
  invalid-JSON response fails today (`PROVIDER_OUTPUT_INVALID` →
  `repair`), so failure mode is unchanged, just with a different parse
  step.
