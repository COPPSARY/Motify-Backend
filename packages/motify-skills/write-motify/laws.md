# Laws for beats, seams and the camera

Supporting file of the write-motify skill. Read it only when the skill says it applies to this request.

## Laws that hold for every shape

**The camera never stops and never resets.** Continuous motion from first frame to last — push, lateral travel, orbit, pull. It never snaps back to scale 1 between beats. Author one `data-camera-world` and move the viewport through it.

**The frame is filled.** One continuous world, field, surface, or colour ground fills the viewport, and objects live inside it. Small boxes adrift in empty space is the failure this rule prevents — but "filled" means a world, not necessarily an app shell.

**One beat, one subject, at a size you can read.** Every beat has a single thing the viewer is looking at, and it is large: a sentence spanning most of the frame, one object at 25-45% of frame height, a proof artifact at 55-80% of frame width. Three or four small cards spread around an empty frame is not a composition — it is a list, and the viewer cannot tell what to look at or what you are claiming. A frame whose largest object covers less than 3% of the canvas is rejected outright as "small cards float in empty space". If your beat is a set of items, either enlarge one of them to be the subject and let the rest support it, or gather them into a single object with real mass.

**Consecutive beats share material.** Not a mechanism at the boundary — actual objects. Something visible before the cut is still visible after it, and it is the thing the next beat is built around. A film where every element is replaced at the cut plays back as separate films spliced together, however sound its carrier chain reads on paper, and it is rejected with "nothing survives the cut". This is stricter than the seam rule and it is the one a viewer actually feels: if you cannot point at the object that is on screen on both sides, the beats are not the same film.

**Plan the carrier chain before the beats.** Write the chain first: one object at 0s, and what it becomes at each boundary — *the sentence becomes the glyph becomes the button becomes the product.* The beats are the states that chain passes through, not containers you fill and then look for a way out of. Two independently built panels cannot morph into each other; one element whose outline changes can.

**Every boundary is a `seam`, and a seam owns time.** A boundary is not the instant one beat's `duration` runs out. It is a span of the timeline with a start, a length, a named carrier, and the two beats it joins — because a handoff given zero seconds is a cut no matter which helper you call. Budget **0.35–1.8s** for each one and schedule the handoff in `timeline.js` across exactly those seconds.

**A seam straddles its cut.** Beats still tile: beat A's interval ends exactly where beat B's begins, at the cut time `c`. The seam opens *before* `c` and closes *after* it — `at < c` and `at + duration > c` — so the outgoing beat is still on screen as the carrier leaves and the incoming beat already exists as it arrives. A handoff scheduled beside the cut instead of across it has no frames in which both sides exist, and the film swaps instead of moving. A boundary at 8.0s with a 1.0s morph is `at: 7.5, duration: 1.0`, not `at: 8.0`.

Because the seam straddles the cut, each beat's layers may be on screen slightly outside its own interval — from the start of its incoming seam to the end of its outgoing seam, and not one frame further.

**Each boundary uses one mechanism**, the one you actually built:

- **MORPH** — the carrier's own outline changes continuously through width, height, radius, surface and role. Word to glyph to button to application is a morph. A zoom or blur followed by a different object is not.
- **MATCH-CUT** — source and destination share position, size, silhouette, direction and speed at the cut, then continue that movement.
- **PARTICLE-REASSEMBLE** — visible fragments leave a real source and travel to construct the destination.
- **final-hold** — the ending only.

Hard cuts, cross-dissolves, fade-to-black and opacity-only scene changes are forbidden between beats. Opacity may clean up internal faces *after* physical continuity is established. Maintain a dominant direction through connected seams: match axis, direction, velocity and motion phase rather than resetting at every boundary. Mark the owner `data-transition-carrier`.

**Clear the outgoing beat — at the end of its seam, not at the cut.** Every element you tag `data-scene="<id>"` must be gone from the frame by `seam.at + seam.duration`, the moment its outgoing seam completes. Past that it is composited on top of the next beat and the film is rejected outright with "still shows the stale layer from <scene>". Before that it is *supposed* to be there: that overlap is the transition.

Clear it in reverse hierarchy: innermost details leave first, along the vector the beat was travelling, then the container. `autoAlpha: 0`, `visibility: hidden`, `display: none`, an opacity at or under 0.02, or travelling fully outside the camera viewport all count as cleared; anything else still counts as on screen. Schedule it with `timeline.set(...)` or a tween that completes at the end of the seam — never an `onComplete` mutation, because scrubbing backwards must restore it.

**The carrier is a container, never a shape.** A painted rectangle with nothing in it is the most common way a generated film reads as broken: the box keeps its own background, border and radius lit while the outgoing face has already left and the incoming one has not arrived, so the viewer watches a coloured plate sit in the middle of the frame. Any painted element between 2% and 60% of the frame that holds no visible content is rejected with "shows an empty plate".

Two ways to be safe, and you should usually take the first:

- **Give the carrier no surface of its own.** Let the faces inside it paint the background, border and radius. Then the carrier is pure geometry, and an empty carrier is an invisible carrier.
- **If the carrier must be painted** — a real card or window whose plate is the point — then its content is never all gone: overlap the outgoing face's exit with the incoming face's entrance so at least one is on screen in every frame, including every frame of the seam. Fade the plate's own background out with the last face that leaves it.

**The carrier lives outside every scene container.** It is a direct child of the `data-camera-world`, a *sibling* of the `data-scene` containers — never inside one, and never carrying a `data-scene` tag itself. This is the single most common way a carrier chain fails: the carrier is authored inside the beat it starts in, that beat is cleared at the cut as the rules require, and the carrier is cleared along with it, so nothing crosses the boundary however the handoff was written. Being outside the subtree is what lets it survive the clear.

```
<div data-camera-world>
  <div data-edit="story-carrier" data-transition-carrier>...</div>  <-- crosses every boundary
  <div data-scene="scene-01">...</div>                              <-- cleared at its seam
  <div data-scene="scene-02">...</div>
</div>
```

The carrier is the exception to clearing, and that is why it must not carry a `data-scene` tag: it is the one thing meant to cross the boundary. The carrier must be visibly on screen on *both* sides of its seam — the composition is seeked to `seam.at - 0.15s` and `seam.at + seam.duration + 0.15s` and the carrier is looked for in both frames. A `morph()` call on an element that is hidden, off camera, or unchanged in size and position at those two times is reported as a hard cut, whatever the source says.

**Action causes result.** A press produces the menu, a scan produces the detection, a convergence produces the document. Nothing appears because the timeline reached a number.

**Type enters cropped and settles.** Important sentences arrive at scale 2.0 or greater, oversized and clipped by the frame, then settle into readable focus. Never simply faded in at final size.

**The resolve comes from the proof.** End on something the film actually showed: hold on the finished result, land one real number, or retreat to a mark and at most four words on a clean or full-bleed brand ground. A logo sign-off is one option, not the default; choose the ending the request calls for. Not a landing-page hero: no explanatory paragraph, no CTA button, no competing links. The film ends on an image, not on a signup form.

## Two mechanical rules

**A statement beat is the statement, alone.** When a beat exists to say something, the sentence is the only thing in the frame. No cards under it, no chips beside it, no panel behind it, no metric tiles in the corner. Nothing but the ground and the line.

This is the sharpest single difference between the reference films and generated output. In the references, every editorial beat — *"clarity disappears"*, *"Import your own voiceovers"*, *"Select your desired style"*, *"Everywhere at once."*, *"Customize it"* — is one line on an otherwise empty ground, held for 1.5 to 2.5 seconds with nothing competing for the eye. Generated films put a headline on the upper third and park two or three small cards underneath it, and the result says nothing, because the viewer does not know whether to read the sentence or inspect the cards.

Exactly two things may share the frame with a statement:

- **A full-bleed ground or atmosphere behind it** — a photograph, a map, a colour flood, a rotating form, a blurred bloom. It fills the whole viewport and sits behind the type. It is the ground, not an object.
- **One inline icon that is part of the sentence**, at the type's own optical size, sitting in the line where a word would be.

If the beat needs to show material, that material is its own beat. Alternate: statement, material, statement, material. Never both at once.

**The camera is still when the type is moving.** Do not put a camera move on every beat. On a statement beat the *type* does the moving — it grows, it pulls back, it settles — and the camera holds, with at most a 1–3% drift so the frame is not frozen. Adding a push on top of type that is already scaling produces two competing movements and reads as drift, not direction.

The camera travels on **space beats**: flying through a corridor of material, tracking across a wide world, orbiting an object, pushing into a detail. Those are the beats built to be moved through, and they are where a camera move means something.

**One dominant direction per film.** Pick a through-line — the camera works its way inward across the film, or travels consistently to the left, or descends. Every camera move advances that line. What kills a film is alternating for the sake of contrast: push, pull, push, pull, or left, right, left, right. That reads as a machine cycling through options, and it is worse than no camera at all.

Concretely, over five beats: hold, track left 700px, push in 1.55, hold at the new scale, pull back to 0.95. Four moves across five beats, all of them continuing the same inward journey, and two beats where the camera does nothing because the type or the object is carrying the motion.

**Motivate every move.** The camera pushes because there is something to look at closely. It pulls back because something outside the frame is about to matter. It tracks because the material continues in that direction. If you cannot say what the move is following, cut it and let the beat be still.

**Name your world.** The stage's first child is the full-bleed world at `width:100%; height:100%`, with a `data-edit` id naming what it is: `scan-field`, `route-space`, `idea-field`, `product-surface`, `editor-canvas`, `workspace`. Everything else is a child of it.

**Keep the camera on the subject.** A viewport-sized world is valid. Enlarge it only for actual spatial travel; never require a 3200-5600px canvas to satisfy a score. Resolve the focal subject's position after parent and child transforms combine. The settled text and proof must remain inside the viewport with readable margins; intentional cropping belongs to the entrance or transition, not the reading hold.

## Interface physics, not cinematic physics

You are a motion designer moving real interface material, not a camera cutting between shots. Four rules, and they are checked against rendered frames.

**Never dissolve, and never through an empty frame.** No cross-fades, no fade-to-white, no fade-to-black between beats. The ground is constant for the entire film: it does not brighten, does not go transparent, and never becomes a blank screen while one beat leaves and the next arrives. A stretch with nothing on screen is rejected with "holds a blank frame", and a boundary with an empty side is rejected with "passes through an empty frame".

**Elements enter and leave along vectors.** Cards slide up from below. Lists expand outward from the row that owns them. Panels grow from the edge they are anchored to. Outgoing material travels off along one motivated direction in reverse hierarchy — innermost details first — while the carrier keeps moving. Opacity only ever cleans up a face *after* it has already physically left.

**Snappy interface easing.** `power2.out` / `power3.out` for arrivals, `back.out(1.3-1.5)` for tactile landings, `power2.inOut` for lateral travel, `expo.out` for camera and geometry. Never `ease: "none"` or `"linear"` on a reveal — a constant-rate opacity ramp is what makes generated text read as a low-opacity overlay instead of an element loading onto a page. Every reveal carries a transform as well as its opacity.

**Rigid material stays sharp.** Text and interface lines do not warp, smear, or blur while they move. Every `blur()` resolves to `blur(0px)`, and the only blur in the film is a deliberate macro-settle focus pull that lands sharp *before* the movement stops.

**Anchor the layout to a structure.** Objects do not drift in open space. Either place them on a visible grid, connect them with interface lines that draw themselves, or group them inside one panel with real mass. Three nodes floating apart with nothing between them reads as a broken interface, not a composed frame — and a beat whose largest object is under 3% of the canvas is rejected outright.
