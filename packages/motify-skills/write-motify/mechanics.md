# Mechanics that break, and the fix for each

Supporting file of the write-motify skill. Read it only when the skill says it applies to this request.

## Mechanics that actually break, and the fix for each

Every item below is a defect that shipped in a generated film, was caught in a rendered frame, and was traced to a specific cause. They are not style notes.

### The compositing traps

**Never share one 3D context between the ground and a tilted panel.** A `transform-style: preserve-3d` world sorts its children by 3D position rather than DOM order, so a flat ground plane and a `rotateY` panel *intersect*, and the browser draws that intersection as a hard diagonal seam straight across the frame. It looks like a lighting bug and it is not one. Declare `perspective` on the specific containers whose direct children rotate, and keep the lit ground out of that context entirely:

```css
.world { position: absolute; inset: 0; perspective: 2000px; } /* the mark  */
.layer { position: absolute; inset: 0; perspective: 2000px; } /* the panel */
```

Two elements that must match silhouette across a handoff need the *same* perspective value and the same perspective origin, or their projections differ and the match reads as a jump.

Use `preserve-3d` only where you genuinely need sibling planes sorted by depth — a corridor of record cards flying past the camera is exactly that case. Parallel planes all facing the camera never intersect, so a corridor is safe; a ground plane and a panel tilted on `rotateY` are not. If the two must coexist, the ground goes outside the 3D context, which is where it belongs anyway.

**The lit ground belongs outside the camera world.** A bloom parented to the world is dragged, scaled and translated by every camera move, so the light source slides around the frame and the glow blooms in one beat and is gone in the next. Put the ground and its bloom in the stage, as siblings *before* the `data-camera-world`, and the light stays fixed to the frame while the world moves through it.

**Stacking order is part of the composition, not an afterthought.** A carrier that morphs into the next beat's panel will paint *over* that panel and hide it completely, so the beat looks empty even though every tween is correct. Anything that overlaps needs an explicit `z-index`, written down once:

```
ground 0 < scenes < morphing mark 18 < panel scene 20
         < shared carrier 24 < export artefacts 30
         < a dragged object 32 < cursor 40
```

A dragged file that renders *behind* the target it is being dropped into is this bug, not a positioning error.

### The empty plate, in the form it actually takes

The rule says a painted carrier must never be on screen with nothing in it. How it really happens: a small mark morphs into a large panel over 1.15s, its logo fades out at the start, and the panel's content fades in at the end, leaving most of a second where a large blank rectangle sits in the middle of the frame. Two fixes, and use both:

- **Let the content ride the morph.** Absolutely position the mark's logo in px and tween it to the exact header slot it will occupy as the box grows, so the box always contains something and the logo lands where the incoming panel's own header logo already is.
- **Let the incoming face grow with the outline** rather than appear at full size on top of it: `fromTo(panel, { scale: 0.62, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, ease: "power2.inOut" })`, started *before* the morph finishes.

**Do not dock a sibling onto a header inside a rotated panel.** It cannot stay registered: the panel's perspective projection moves its header, the sibling is not subject to that projection, and the mark ends up floating outside the panel's corner. Morph the carrier *into* the panel instead, and give the panel its own header logo. The icon becoming the app is a stronger move anyway.

### GSAP timing traps

**A stagger is folded into every repeat.** `totalDuration = (duration + staggerTotal) * (repeat + 1)`. A 158-target breathing tween at `{ duration: 0.62, repeat: 17, stagger: { each: 0.011 } }` is not 11 seconds, it is `(0.62 + 1.74) * 18 = 42.5` — which silently stretched a 45-second film to 60. Keep the per-cycle stagger tiny and check the arithmetic.

**`expo.out` resolves almost immediately.** At 20% of its duration an `expo.out` is already about 93% complete. A "type arrives huge and pulls back" built as one `expo.out` scale tween therefore never shows the huge state: it is gone within two frames and the viewer sees a small line that was briefly blurry. Build the oversized moment explicitly instead:

```
t+0.05  autoAlpha 0 -> 1, and scale 3.15 -> 3.30 over 0.9s (a slow creep)
t+0.18  blur 6px -> 0 over 0.44s      focus resolves while it is still huge
t+0.95  scale -> 1.0 over 1.1s, expo.out          this is the pull-back
t+2.05  reading hold, scale -> 1.035, x -> -14
```

The oversized state needs roughly a second of screen time to be read. And use the move once: opening huge and then growing to the edge again later is the same idea twice.

**Blur on a transformed element is scaled by the transform.** `blur(6px)` on a line at `scale: 3.15` reads as about 19px. Pick the radius for the scaled result.

### Determinism, concretely

The editor scrubs backwards, so the timeline is seeked out of order constantly. Two rules make that safe.

**Never let two tweens own the same property in overlapping windows.** A caret blink with `repeat: 5` that outlives the tween meant to hide it will keep overwriting the hide, and the element's final state then depends on which way the playhead arrived. Close the blink before the hide starts.

**A bare `to()` records its start value lazily, at whatever moment it first renders.** Any tween whose start depends on an earlier tween's end is therefore non-deterministic under seeking. Use `fromTo` with explicit endpoints and `immediateRender: false` for every face swap, label swap and re-show:

```js
t.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, immediateRender: false }, at);
```

`immediateRender: false` also means the from state waits for `at`: until then the element sits at its CSS state, fully visible, and then snaps away to animate in. When this is the element's first entrance, set its from state at time 0 as well — `t.set(el, { autoAlpha: 0 }, 0)` — so the first frames do not flash it.

Text that changes mid-film is driven from a proxy so it restores on rewind:

```js
const p = { v: 0 };
t.to(p, { v: 1, duration: 0.4, ease: "none",
  onUpdate() { el.textContent = p.v < 0.5 ? before : after; } }, at);
```

`onUpdate` is safe under scrubbing; `onComplete` mutations are not.

### Framing a product UI you intend to push into

Work out the reachable region *before* choosing a macro target. With a panel of width `W` centred in a frame of width `F`, a camera at scale `s` can only be centred on `|x| <= W/2 - F/(2s)` before the ground shows past the panel edge. A 1660px panel in a 1920 frame at `s = 1.0` can travel nowhere; to macro on a menu 494px left of centre it needs `s >= 2.46`. That is not a problem — that *is* the macro shot — but discovering it after authoring the move is.

Author interface text at roughly 1.6x its real pixel size. A 1:1 app shell has 20px body text, which is illegible at 1080p in the wide shot and forces every beat to become a close-up.

### Product truth, in the details

**Show the interaction the product actually has.** A voice "chosen" by clicking a card that already displays the chosen voice shows nothing. Open the picker, let the list be read, highlight rows under the pointer, select one, and land the result in *both* places the real UI displays it. The same for a file: the pointer picks it up, carries it on one arc, the target lights while the file is over it, and the drop is the release. A file that teleports into a dropzone is not an upload.

**Prove features with the artefact, not with a caption row.** Three columns of small text under a dropzone reading "Speaker Identification / Accurate Timestamps / Multi-language Support" is the tiny-cards failure wearing a different hat. Put the proof in the thing the beat produces: labelled and colour-coded speakers, per-segment timestamps, and a "Khmer + English" chip in the transcript header say all three, at readable size, as evidence.

**Use real icon geometry.** Inline the actual Lucide path data as SVG. A bordered empty rectangle standing in for a file icon, or a hand-drawn approximation of a microphone, is visible immediately. A component library cannot be imported into `composition.html`; its paths can be pasted into it.

**A waveform is speech, not noise.** Random per-bar `scaleY` jitter reads as a broken equaliser. Generate a mirrored envelope with syllable groups and two real breaths, draw it left to right *as it is produced*, and fill the played portion behind a travelling playhead. Two stacked copies of the same geometry, the upper one clipped by `inset()`, gives the played/unplayed split for free.

### Non-Latin type

A script with its own metrics needs its own face and its own settings. Khmer stacks diacritics above and below the baseline: bundle a real Khmer face (Kantumruy Pro, Noto Sans Khmer), set `letter-spacing: 0` — the negative tracking that suits a Latin display face breaks the script — and give it more line height than the Latin line beside it. Falling back to a system default is immediately visible to anyone who reads the language, and it is the detail that tells them the film was not made for them.
