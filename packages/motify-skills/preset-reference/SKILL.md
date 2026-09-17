---
name: preset-reference
description: Use when authoring Motify GSAP timelines with the runtime EASE vocabulary or callable motion presets.
---

# The Motify runtime API

Every name below is already destructured into the scope of your `buildTimeline(context)` — alongside `gsap` — by the compiler. Call these directly. Do not import them, do not redeclare them, and do not re-implement one by hand as a chain of raw tweens: the tuned version is the house style, and the quality pass scores a film on whether it used them.

## Ease vocabulary: `EASE`

The film's ease vocabulary.

GSAP's stock curves top out at a narrow dynamic range: `power2.inOut` moves
at only 3x its mean velocity at the fastest point, and `sine.inOut` at 1.57.
Stretched over the two-to-five second travels a film is actually built from,
that reads as constant velocity — the middle of the move has no ramp in it.

These are registered `CustomEase` curves with the range a time ramp needs.
Each is annotated with its peak-to-mean velocity ratio (linear = 1.00) and,
for the arrival curves, how much distance it covers in the first 20% of its
duration — `expo.out` covers 93% there, which is why an oversized entrance
built on it is gone before it can be read.

Pick by what the motion *is*, not by how long it lasts:

- `EASE.cameraRamp` — a camera or world travelling a long way. Holds, blasts
  through the middle, settles. Use for lateral tracks and z-flies.
- `EASE.travel` — an object crossing the frame under its own direction.
- `EASE.material` — a carrier's own outline changing. Weighted, not snappy.
- `EASE.arrive` — something landing in place. Fast off the mark, long tail,
  but still legible at the start.
- `EASE.depart` — something accelerating out of frame. Peaks at the exit.
- `EASE.settle` — an oversized element pulling back to rest.

Ambient drift and breathing loops stay on `sine.inOut`, and a constant-rate
readout — an audio playhead, a progress bar — stays on `none`. Neither is a
directed move, so neither wants a ramp.

Measured behaviour of each curve:

- `EASE.cameraRamp` — peak 5.90x, 3% covered by 20% — a true hold-blast-settle ramp.
- `EASE.travel` — peak 3.82x, front-loaded ramp for directed object travel.
- `EASE.material` — peak 3.75x, slightly heavier through the middle than `travel`.
- `EASE.arrive` — peak 5.25x at t=0, 72% covered by 20% — punchier than `power2.out` (49%) without `expo.out`'s two-frame collapse.
- `EASE.depart` — peak 8.68x at t=1 — accelerates all the way out.
- `EASE.settle` — peak 6.00x at t=0, 73% covered by 20% — for giant-to-settle pullbacks.

Pass one as the `ease` value like any GSAP curve: `timeline.to(card, { x: 240, duration: 1.1, ease: EASE.travel })`, or as a preset's `ease` option. Reach for a stock GSAP curve only in the two cases named above: `sine.inOut` for ambient drift and breathing, `none` for a constant-rate readout.

## Presets

A trailing `?` marks an optional argument; `= value` is the default that applies when you omit an option. A preset returns the caller's timeline unless an arrow gives another type, so only the ones marked `-> HTMLElement[]` may be destructured or indexed; doing that to any other one crashes the film.

- `reveal(timeline, target, options?)`
  - at: gsap.Position; duration: number = 0.55; ease: string = "power3.out"
- `slide(timeline, target, options?)`
  - direction: "up" | "right" | "down" | "left"; distance: number = 56; at: gsap.Position; duration: number = 0.68; ease: string = "power4.out"
- `scalePop(timeline, target, options?)`
  - at: gsap.Position; duration: number = 0.62; ease: string = "back.out(1.35)"
- `spring(timeline, target, options?)`
  - at: gsap.Position; duration: number = 0.85; ease: string = "elastic.out(1, .72)"
- `blurReveal(timeline, target, options?)`
  - at: gsap.Position; duration: number = 0.72; ease: string = "power3.out"
- `maskWipe(timeline, target, options?)`
  - direction: "up" | "right" | "down" | "left" = "right"; distance: number; at: gsap.Position; duration: number = 0.78; ease: string = "expo.out"
- `gradientSweep(timeline, target, options?)`
  - at: gsap.Position; duration: number = 1.4; ease: string = "power2.inOut"; fromPosition: string = "200% 0"; toPosition: string = "0% 0"
- `continuousTextGradient(element) -> HTMLElement[]`
- `rotateReveal(timeline, target, options?)`
  - at: gsap.Position; duration: number = 0.7; ease: string = "power4.out"
- `staggerEntrance(timeline, targets, options?)`
  - stagger: number = 0.09; direction: "up" | "right" | "down" | "left"; distance: number = 52; at: gsap.Position; duration: number = 0.58; ease: string = "power4.out"
- `staggerExit(timeline, targets, options?)`
  - stagger: number = 0.055; direction: "up" | "right" | "down" | "left"; distance: number = 34; at: gsap.Position; duration: number = 0.42; ease: string = "power3.in"
- `cameraPush(timeline, target, options?)`
  - at: gsap.Position; duration: number = 1.35; ease: string = "power3.inOut"; scale: number = 1.18; x: number = 0; y: number = 0
- `cameraPull(timeline, target, options?)`
  - at: gsap.Position; duration: number = 1.25; ease: string = "power3.inOut"; scale: number = 1; x: number = 0; y: number = 0
- `cameraZoomPan(timeline, target, options?)`
  - startScale: number = 2.6; endScale: number = 1.0; startX: number = 0; endX: number = 0; startY: number = 0; endY: number = 0; at: gsap.Position; duration: number = 0.95; ease: string = "power3.out"
- `editorialTextReveal(timeline, element, options?) -> HTMLElement[]`
  - stagger: number = 0.085; distance: number = 18; blur: number = 5; at: gsap.Position; duration: number = 0.48; ease: string = "power3.out"
  - Words resolve onto their final baseline without zooming or bouncing the sentence. Layout and accent markup stay authored; all motion is seekable.
- `giantKineticCrop(timeline, element, options?) -> HTMLElement[]`
  - startScale: number = 2.8; endScale: number = 1.0; panX: number = 0; unit: "words" | "chars" = "words"; stagger: number = 0.045; settleEase: string = "back.out(1.35)"; xPercent: number; yPercent: number; at: gsap.Position; duration: number = 0.88; ease: string = "power3.out"
- `waterfallTextReveal(timeline, element, options?) -> HTMLElement[]`
  - startScale: number = 2.2; endScale: number = 1; panX: number = 0; startX: number = 0; startY: number = 44; rotateX: number = 0; rotateY: number = 0; stagger: number = 0.055; xPercent: number; yPercent: number; at: gsap.Position; duration: number = 0.55; ease: string = "back.out(1.35)"
- `ambientWaves(timeline, waves, options?)`
  - totalDuration: number = 24; yOffset: number = -20; scaleXOffset: number = 1.2; at: gsap.Position = 0; duration: number; ease: string
- `sceneHandoff(timeline, outgoing, incoming, options?)`
  - direction: "up" | "right" | "down" | "left" = "left"; distance: number; at: gsap.Position; duration: number = 0.82; ease: string = "power3.inOut"
- `morph(timeline, target, styles, options?)`
  - at: gsap.Position; duration: number = 0.8; ease: string = "power3.inOut"
- `splitText(element, unit) -> HTMLElement[]`
- `textReveal(timeline, element, options?) -> HTMLElement[]`
  - stagger: number = 0.045; direction: "up" | "right" | "down" | "left"; distance: number; at: gsap.Position; duration: number = 0.62; ease: string = "power4.out"; unit: "words" | "chars" = "words"
- `wordSlideRotate(timeline, element, options?) -> HTMLElement[]`
  - stagger: number = 0.045; direction: "up" | "right" | "down" | "left"; distance: number = 42; at: gsap.Position; duration: number = 0.58; ease: string = "power3.out"; rotation: number = 4
- `charSpringBounce(timeline, element, options?) -> HTMLElement[]`
  - stagger: number = 0.025; direction: "up" | "right" | "down" | "left"; distance: number = 30; at: gsap.Position; duration: number = 0.48; ease: string = "back.out(1.7)"
- `squashAndStretch(timeline, target, options?)`
  - factor: number = 0.14; direction: "horizontal" | "vertical"; at: gsap.Position; duration: number = 0.44; ease: string = "back.out(1.4)"
- `anticipate(timeline, target, options?)`
  - distance: number = 18; direction: "left" | "right" | "up" | "down" = "right"; scale: number = 0.95; at: gsap.Position; duration: number = 0.28; ease: string = "power2.inOut"
- `motionArc(timeline, target, options)`
  - startX: number = 0; startY: number = 0; endX: number (required); endY: number (required); arcHeight: number = 38; at: gsap.Position; duration: number = 0.72; ease: string
- `impactShake(timeline, target, options?)`
  - intensity: number = 10; rotational: boolean = true; at: gsap.Position; duration: number = 0.42; ease: string
- `errorWobble(timeline, target, options?)`
  - distance: number = 12; angle: number = 3.5; at: gsap.Position; duration: number = 0.48; ease: string
- `ambientBreathing(timeline, target, options?)`
  - minScale: number = 0.985; maxScale: number = 1.015; yDrift: number = 3; repeat: number = 1; at: gsap.Position; duration: number = 2.8; ease: string = "sine.inOut"
- `ambientFloat(timeline, target, options?)`
  - distance: number = 8; rotation: number = 1.5; repeat: number = 1; at: gsap.Position; duration: number = 3.2; ease: string = "sine.inOut"
- `stepSurgeCounter(timeline, targetElement, options)`
  - start: number = 0; surgeTarget: number = Math.round(start + (end - start) * 0.74); end: number (required); suffix: string = ""; prefix: string = ""; pauseDuration: number = 0.12; at: gsap.Position; duration: number = 1.25; ease: string
- `perspectiveCardReveal(timeline, target, options?)`
  - rotateX: number = 16; rotateY: number = -12; z: number = -120; perspective: number = 1200; at: gsap.Position; duration: number = 0.74; ease: string = "back.out(1.25)"
- `matchCut(timeline, outgoing, incoming, options?)`
  - scale: number = 1.0; at: gsap.Position; duration: number = 0.45; ease: string
- `maskReveal(timeline, target, options?)`
  - shape: "rectangle" | "circle" = "rectangle"; direction: "left" | "right" | "up" | "down" | "center" = "right"; at: gsap.Position; duration: number = 0.78; ease: string = "expo.out"
- `punchIn(timeline, target, options?)`
  - scale: number = 1.12; origin: string = "50% 45%"; holdDuration: number = 0.3; returnToNormal: boolean; at: gsap.Position; duration: number = 0.22; ease: string = "back.out(1.4)"
- `captionPop(timeline, target, options?)`
  - activeColor: string; normalColor: string; distance: number = 14; at: gsap.Position; duration: number = 0.34; ease: string = "back.out(1.4)"
- `cutTheCurve(timeline, options)`
  - outgoing: Target (required); incoming: Target (required); direction: "left" | "right" | "up" | "down" = "left"; distance: number = 230; blur: number = 8; at: gsap.Position; duration: number = 0.6; ease: string
- `zoomThrough(timeline, options)`
  - outgoing: Target (required); incoming: Target (required); scaleExit: number = 1.2; scaleEntry: number = 0.75; blur: number = 10; at: gsap.Position; duration: number = 0.6; ease: string
- `inverseZoomThrough(timeline, options)`
  - outgoing: Target (required); incoming: Target (required); scaleExit: number = 0.8; scaleEntry: number = 1.25; blur: number = 10; at: gsap.Position; duration: number = 0.7; ease: string
- `pullbackComplete(timeline, lead, tail, options?)`
  - camera: Target; startScale: number = 2.6; endScale: number = 1; hold: number = 0.5; stagger: number = 0.06; settleEase: string = "back.out(1.4)"; at: gsap.Position; duration: number = 0.9; ease: string
  - **The Pullback Complete.** One massive cropped line settles; the camera pulls back and the rest of the sentence arrives in the negative space the retreat opened up. The pullback and the completion are one move — the tail never fades in on its own, it occupies room that was always there.
- `growAndComplete(timeline, lead, tail, options?)`
  - startScale: number = 0.55; stagger: number = 0.07; settleEase: string = "back.out(1.3)"; at: gsap.Position; duration: number = 0.5; ease: string = "power3.out"
  - **Grow and Complete.** The other way a sentence finishes itself, and the one the reference films use most. The opening fragment sits small and centred, then grows to full size while the rest of the sentence arrives beside it. The line re-centres continuously as words land, so the sentence never appears to grow rightward off its own centre — that re-centring is what makes it read as one line completing rather than as words being appended. Measured: the fragment grows over about 0.5s, words land 0.07s apart starting a third of the way in, and the whole build is done in roughly 0.75s.
- `macroSettle(timeline, element, options?) -> HTMLElement[]`
  - startScale: number = 3; endScale: number = 1; blur: number = 18; unit: "words" | "chars" = "words"; stagger: number = 0.035; at: gsap.Position; duration: number = 0.85; ease: string = "expo.out"
  - **Macro Settle.** Type arrives at 300% scale, heavily blurred, then snaps into crisp 100% focus. The snap is the point: the blur resolves in the middle of the move on a `power4.out`, so the line is sharp well before it stops travelling. Text that stays soft while it is still moving reads as a video artefact rather than as a lens finding focus.
- `kineticAnchor(timeline, anchor, orbiting, options?) -> HTMLElement[]`
  - distance: number = 120; rotation: number = 8; stagger: number = 0.07; at: gsap.Position; duration: number = 0.8; ease: string = "back.out(1.4)"
  - **Kinetic Anchor.** One word holds absolutely still while the rest of the sentence physically revolves or slides around it. The anchor is never tweened. Everything the viewer reads as movement belongs to the words travelling past it, which is what makes the still word register as the subject of the line rather than as text that simply failed to animate.

