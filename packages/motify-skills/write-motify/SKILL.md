---
name: write-motify
description: Read after runtime-contract whenever you create, edit, retime, or repair a film. Creative direction for Motify product films and SaaS ads (transformation chain, shots, camera, typography, transitions, timing) and how to finish one with validate_generation and finalize_generation.
---

# Write Motify compositions

You are filming **what a product does to the world**, not what its interface looks like.

The most common failure is treating "product video" as "pretty dashboard": a gradient, an app shell, a button press, some cards, a zoom out. That film communicates nothing, because the viewer only learns the product has a screen — which they already assumed. Build the concept first. An interface is one possible vocabulary for showing a concept, and usually not the right one.

The `runtime-contract` skill governs execution and wins any conflict. Read it before you write anything.

These two skills are enough to make a film. `runtime-contract` includes a complete worked `composition.html` and `timeline.js`: write yours in that shape. The other skills (`scene-components` for kit classes and beat templates, `gsap-core` and `gsap-timeline` for the GSAP API, `gsap-performance` for heavy films, `scene-design`) cost tokens on every later step: read one only when this request needs it. Reading is never the goal; the two files you write are.

## Step 1 — Write the transformation chain

Before choosing a single visual, write the chain: four to six states, from what the world looks like before the product to what it looks like after. This is the film. Each state is a beat.

The form is always **input state -> the product's actual mechanism -> output state**.

```
AI security scanner
  website -> SCANNER -> code streams through -> threats detected
          -> red nodes isolate -> clean secure state

Collaborative writing tool
  messy ideas -> several people contribute -> ideas converge
              -> document crystallises -> finished piece

Delivery optimisation
  orders -> many tangled routes -> routes reorganise
         -> optimal paths emerge -> deliveries complete

Motion-graphics generator
  a sentence -> words break into parts -> parts take on motion
             -> the sentence is now a moving scene
```

Compare the first one with the dashboard version it replaces: gradient -> dashboard -> scan button -> vulnerability cards -> zoom out. Nothing in that sequence is the product's mechanism. It is furniture.

Rules for the chain:

- Every state must be **visually different from the one before it**, not the same screen with different copy.
- The middle states are the product's mechanism. If you cannot name a mechanism, the film has no content yet — go back and find what actually changes.
- Give each scene a `label` that names its state, so the chain is readable from the saved scenes.


## Step 2 — Choose the vocabulary

Pick the shape that fits this request, and keep to it for the whole film. The five shapes:

| Shape | The subject is | Interface? |
| --- | --- | --- |
| **transformation** (default) | material changing state: scattered to ordered, noise to signal, many to one | focused input/result evidence when useful |
| **hero-object** | one artefact: a mark, a device, a symbol | no |
| **editorial** | the words themselves; type and colour carry the argument | no |
| **data** | real numbers, with units and periods | only as the surface holding them |
| **task** | the interface itself, genuinely used | yes — this is the one |

**The interface test.** Build a product UI only when *both* are true: the request asks to see the product used (a walkthrough, a tour, "show the app", "demo the interface"), **and** the interface is the thing the viewer must judge. An AI assistant whose entire product *is* the conversation surface passes. A security scanner, a logistics optimiser, a writing tool, an infrastructure product almost never do — their concept lives outside the screen.

When in doubt you are making a **transformation** film. The chain is the spine; focused product details may provide evidence, never become a repeated shell. Naming an AI assistant, analytics product, or a closing logo does not by itself request a walkthrough, a chart film, or a logo sting.


## Step 3 — Make each state physical

A state is not a caption. It is something on screen with mass, position, and behaviour.

| State in the chain | How to stage it |
| --- | --- |
| Chaos, overload, mess | Many real objects crowding the frame, overlapping at depth, drifting inward. Not a caption saying "it is messy". |
| A process running | Material physically travelling through a gate, beam, or aperture — streams of code, orders, words — with the gate reacting as it passes. |
| Detection, selection | Some of the passing material changes state in place: colour, outline, isolation, being pulled out of the flow. |
| Convergence, ordering | Scattered elements travel along arcs to their positions and lock, in a visible order, the layout resolving as they land. |
| A result, a finished thing | One object built from the earlier material, held still enough to read, camera drifting. |
| The ending | Pick the one that fits the request: hold on the finished result, land one real number, a tagline alone, or pull back to the mark and at most four words. A logo sign-off is one option, not the default. |

The material must **persist through the chain**. The code that streamed is the code that gets flagged. The scattered ideas are the sentences in the finished document. The tangled routes are the optimised ones. Recognisable continuity is what makes the film an argument instead of a slideshow.


## Read these only when they apply

Everything above and below is enough to plan a film. These files hold the detail. Each costs tokens on every later step, so read one only when the request needs it, and read it whole with a single read_file call (no grep, no offset and limit) because extra search steps cost more than the file.

| File | Read it when |
| --- | --- |
| `reference-standard.md` | You are designing the look: grounds, typography, the shot catalogue, camera, ad direction. |
| `moves.md` | You are authoring type or camera motion: the six moves, the type presets, a worked 22s film. |
| `laws.md` | You are planning scene boundaries: seams, carriers, clearing the outgoing beat, statement beats, one camera direction. |
| `mechanics.md` | Something breaks, or before you call `validate_generation`: 3D and stacking traps, the empty plate, GSAP and seek determinism, non-Latin type. |

## The laws that always hold

- **One chain, one persistent material.** Every beat is a state of your transformation chain, and the same material is on screen on both sides of every boundary.
- **One subject per beat, at a readable size.** A statement beat is the sentence alone on the ground.
- **The ground is a lit space, never flat white and never empty, and it is chosen or authored for this film.** Take its colours from the brand; two films for different products should not share one. No cross-fades, fades through white or black, or hard cuts between beats.
- **Every boundary is a span of time with a carrier.** It opens before the cut and closes after it, and the carrier is a container outside every scene, never a bare painted shape.
- **The outgoing beat is cleared by the end of its seam.** Reverse hierarchy, with `timeline.set` and never an `onComplete` mutation.
- **The timeline must survive scrubbing.** Use `fromTo` with `immediateRender: false`, no two tweens on the same property in one window, and no unbounded repeat.
- **No stretch over 1.6s with nothing scheduled.** Type finishes settling before its exit begins.
- **Never claim a render was reviewed unless you inspected it.**

## Timing

- Tactile actions (press, chip, toggle): **0.15-0.3s**
- Type settle per word: **0.35-0.5s**, stagger **0.05-0.09s**
- Camera and geometry moves: **0.9-1.4s**
- Reading hold after the last word settles: **0.8-1.6s** for a short sentence
- Result inspection hold: **1.5-3.0s**, camera still drifting

`exitStart >= lastWordSettled + readingHold`, where `lastWordSettled = entryStart + (wordCount - 1) * stagger + wordDuration`. Compute it; do not estimate.

**No stretch longer than 1.6s may pass with nothing scheduled.** During any hold one bounded action continues: material travelling, a counter, a scan, a drawn line, or the camera's own settle. A frozen frame is the single most reported defect.

Easing: `back.out(1.2-1.6)` for tactile arrivals, `expo.out` / `power4.out` for camera and geometry, `power2.inOut` for lateral travel. Never `bounce.out` or `elastic.out`.

## Scaling to the requested duration

Keep the chain's order and drop or merge middle states — never compress every beat uniformly, and never cut the opening state or the resolve.

- **10s or less**: three states. Before, mechanism, after.
- **15s**: four states.
- **20-25s**: five or six states, the full chain.
- **30s or more**: deepen the mechanism with a second pass over the same material. Never bolt on an unrelated feature.

## Using HyperFrames components

Where a skill's reference files include a HyperFrames component, read it with `read_file`. It is a reference implementation, not a callable function.

- Take its markup, CSS, and the mechanic. Discard script wrappers, CDN imports, independent clocks, and `data-composition-*` attributes.
- Re-theme every colour, radius, and type choice to the requested product.
- Drive it from `context.timeline` at explicit seconds.
- Mark each adapted owner with `data-hyperframe-component="<name>"`.
- Use only what your chain's states need. Do not pad to hit a count.


## Before returning

1. Can I write out my transformation chain, and is each beat one of its states?
2. Is the middle of the chain the product's actual mechanism, or is it furniture?
3. Did I build an interface? If so, does the request pass the interface test, or did I reach for a dashboard out of habit?
4. Does the same material persist from the first state to the last?
5. Does the camera move continuously, without resetting between beats?
6. Is any painted shape ever on screen with nothing inside it?
7. Does an object visibly carry every boundary — and for each seam, is that object on screen and changing at both `at - 0.15s` and `at + duration + 0.15s`?
8. Does every seam open before its cut and close after it, rather than starting at the cut?
9. Is any stretch longer than 1.6s without a scheduled action?
10. Does every sentence finish settling before its exit begins?
11. Does the ending resolve something that was actually shown?
12. Did I choose this film's theme, layout, accent and ending from the request, instead of copying an example's?

Self-assigned scores and helper counts are not evidence. Answer the twelve questions.

## Finishing the film

You do not return the film as a reply. You write it as two files and save it through two tools.

1. Write `/composition.html` (a single `<template>`, embedded `<style>`, no `<script>`) and `/timeline.js` (exports `buildTimeline`) with `write_file`. For an existing project they are already in your workspace: change them with `edit_file`.
2. Call `validate_generation` with only the metadata below. It reads the two files from your workspace, so never paste their content into the call. Fix every error; warnings are worth fixing but do not block.
3. Call `finalize_generation` the same way. This is the only way your work reaches the user's project. It validates again, and a film with errors is not saved.

The metadata:

| Field | Meaning |
| --- | --- |
| `title` | Non-empty film title. |
| `duration` | Total seconds, greater than 0. |
| `width`, `height` | Integer pixels, 1920x1080 unless the request names another size. |
| `fps` | Frames per second. |
| `scenes` | One entry per beat: `id`, `label`, `start`, `duration`, `accent`. Optionally `tracks`, each with `id`, `label`, `kind` (`Text`, `Element`, `SVG`, `Background` or `Camera`), `start`, `end`. |
| `reply` | What you tell the user about the film, non-empty. |

All scene IDs must agree with the `data-scene` containers in `composition.html`. Scene `start` and `duration` use final playback seconds, tile without gaps, stay within `duration`, and agree with the GSAP timeline. `accent` is the beat's brand colour.

Every boundary still needs a carrier that exists in `composition.html` and is tweened by its `data-edit` id in `timeline.js` across the boundary's own seconds. A carrier you never animate is a weak film, even though nothing in the metadata names it.

If `finalize_generation` reports a conflict, the project changed underneath you. Tell the user to retry; do not call it again.
