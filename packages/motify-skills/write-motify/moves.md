# Motion moves, type treatments and a worked film

Supporting file of the write-motify skill. Read it only when the skill says it applies to this request.

## How to actually shoot the film, move by move

Everything below was measured off the reference films frame by frame at 8 frames per second. The numbers are what those films really run at. Build the moves, do not invent your own — the difference between these and a slide deck is entirely in the timing.

### Move A — The Oversize Pull-Back

The signature opening. The line begins **larger than the frame**, cropped by both the left and right edges so only two or three words are legible, and shrinks until the whole sentence fits. The sentence completes because the frame effectively widened, not because words faded in.

```
t+0.00  line at scale 2.9, opacity 1, cropped by both edges
t+0.00  → scale 1.0 over 0.65s, ease "expo.out"
t+0.65  full sentence visible at reading size, centred
t+0.65  hold 0.9s with a drift: scale 1.0 → 1.03, x 0 → -14
t+1.55  exit: opacity → 0 over 0.3s, or blur 0 → 12px
```

Measured: the reference runs this in **0.6–0.75s**. It is fast. A two-second pull-back reads as sluggish. Use `macroSettle(timeline, line, { at, startScale: 2.9, blur: 0, duration: 0.65 })` and give the beat a matching `cameraPull`.

### Move B — Grow and Complete

The other way a sentence finishes itself, and the more useful one. The opening fragment sits **small and centred**, then grows while the rest of the sentence arrives beside it and the line re-centres continuously.

```
t+0.00  fragment "Import" at scale 0.55, opacity 1, centred
t+0.00  → scale 1.0 over 0.50s, ease "power3.out"
t+0.18  remaining words fade 0 → 1, left to right, 0.07s apart,
        each also y 10 → 0 on "back.out(1.3)"
        the line's x shifts left each time a word lands so the
        whole sentence stays centred — never let it grow rightward
t+0.55  complete sentence, centred, full size
t+0.55  hold 1.0s with scale 1.0 → 1.04 continuing
```

The words arrive **ghosted then solid** — an opacity ramp, not a slide from off-screen. Total build is about **0.75s** for a five-word line.

### Move C — Macro Settle, and the snap is the point

```
t+0.00  scale 3.0, blur 20px, opacity 0
t+0.00  → opacity 1 over 0.12s
t+0.05  → blur 20px → 0px over 0.25s, ease "power4.out"
t+0.00  → scale 3.0 → 1.0 over 0.85s, ease "expo.out"
t+0.85  settled, then drift scale 1.0 → 1.04 and x 0 → +22
        across the rest of the hold
```

Focus resolves at **t+0.30**, a third of the way through the movement. The line is sharp while it is still travelling. Text that stays soft until it stops looks like a video artefact. Use `macroSettle(...)`, which already runs these numbers.

### Move D — Ground flood

Never cross-fade between beats. Flood the ground instead:

```
t+0.00  next ground colour enters as a full-bleed layer,
        scaleY 0 → 1 from one edge, or x -100% → 0,
        over 0.45s, ease "power3.inOut"
t+0.10  outgoing type opacity → 0 over 0.2s, or blurs out
t+0.30  incoming type begins Move B or Move C on the new ground
```

The frame is never empty: the new ground is already covering the viewport before the old type has finished leaving.

### Move E — The object rises and never stops

A device, icon or artefact enters from **outside the frame edge**, not by fading in:

```
t+0.00  y +55% (below the frame), rotation -8deg, scale 0.85
t+0.00  → y 0, rotation 0, scale 1.0 over 1.1s, ease "expo.out"
t+1.10  continuous rotation ±6deg and y ±12px for the whole beat,
        so the object is never still
```

Size it at **30–45% of frame height**, tilt it `rotateY 14–22deg` with `perspective: 1600px`, and give it a real contact shadow.

### Move F — Word-by-word onto a fixed line

`Ideas.` → `Ideas. Notes.` → `Ideas. Notes. Tasks.` Lay all three out in their **final positions** first, hide the later ones, and reveal each with `y: 22 → 0` plus opacity on `back.out(1.4)`, **0.42s apart**. The earlier words never move.

## The end-to-end film

One worked example, 22 seconds, beat by beat, with the times it actually ran at — this demonstrates the *rules* (scale contrast, camera discipline, pacing), not a structure to reproduce. Build your own beat count, order, ground colours, and shot choices from this request's own transformation chain (Step 1); do not default to this beat's five-part shape, its grounds, or its shot list just because it worked here. Two different products run through this skill should not land on the same beat count, the same ground palette, or the same camera pattern unless their chains genuinely call for it.

**Beat 1 — 0.0 to 4.2s. The claim, oversized.**
Ground floods in as a full-bleed dark or brand colour. The opening statement plays **Move A**: starts cropped by both frame edges at scale 2.9, pulls back to reading size over 0.65s. Hold with a drift. One word in the brand hue. Camera: a slow `cameraPull` from 1.15 to 1.0 across the whole beat so the frame is never static.

**Beat 2 — 4.2 to 8.6s. The problem, made physical.**
Ground floods to the second colour (Move D). The subject is now an **object, not a sentence**: a device rising from below (Move E), a corridor of real cards at Z depths from -1400px with the near plane blurred, or overlapping translucent circles. It occupies 35–55% of the frame. A short line sits over it, entered with **Move C**, no larger than half the height of Beat 1's statement — the scale contrast between beats is what makes the film read as directed. Camera: a lateral track of 500–900px, opposite in direction to Beat 1's move.

**Beat 3 — 8.6 to 13.4s. The mechanism, in macro.**
Push in hard. `cameraPush` scale 1.0 → 1.55 over 1.4s on `expo.out`, landing on **one detail**: a word being selected with a highlight sweeping across it, a value counting up, a control being pressed, a caret typing. The detail fills 40–65% of frame width. This is the closest shot in the film and it must be genuinely close — if it looks like the previous beat with slightly bigger elements, it is not a macro.

**Beat 4 — 13.4 to 17.8s. The result, pulled back.**
`cameraPull` from 1.55 back to 0.95 over 1.6s, revealing what the mechanism produced: the finished artefact, the organised set, the generated image, the completed table — at 55–80% of frame width. A line above or below it plays **Move F**, three short words landing 0.42s apart.

**Beat 5 — 17.8 to 22.0s. The brand.** (One possible ending. Use it only when the request asks for a brand sign-off; otherwise end on the result or a single number.)
Ground floods to the brand colour full-bleed (Move D). The mark and wordmark arrive together at **25–40% of frame width**, centred, with at most four words or a bare URL beneath. The mark enters at scale 0.7 with a `back.out(1.5)` over 0.6s; the words follow 0.25s later. Hold to the last frame with a 1.0 → 1.03 drift. Nothing else is in the frame.

**A deliberate scale rhythm is the film — this example's Huge → medium → macro → wide → medium is one such rhythm, not the required one.** If every beat sits at the same size, no amount of correct colour or easing will save it. Write the scale of each beat's subject down before you author anything, and make sure no two adjacent beats match — the specific sequence of sizes is yours to design from the chain, not copied from here.

**Only some beats get a camera move, and which ones is a choice, not a formula.** In the example above the camera holds through Beat 1 while the type pulls itself back, tracks once in Beat 2, pushes in Beat 3, holds again, then pulls back in Beat 5 — one possible pattern of moves continuing one inward journey. Design your own pattern from what this film's beats actually need; what stops a still beat from freezing is the type or the object still moving inside it, plus a 1-3% drift, not a camera move bolted onto every beat.

## Grow to the edge, then retreat to somewhere new

The strongest single move in this vocabulary, and the one to reach for when a beat needs to land:

A line settles at reading size, then **keeps growing** — past comfortable, until it is cropped by the frame and only two or three words are legible. Hold it there for a beat. Then the camera pulls back, and the retreat does not simply undo the zoom: it lands somewhere the film has not been. The frame that opens up is already occupied by the next thing — the object the line was about, the interface it names, the mark it resolves into.

```
t+0.0   line settles at scale 1.0
t+0.6   scale 1.0 → 1.9 over 1.1s, expo.out. The frame can no longer hold it.
t+1.7   hold cropped, 0.5s, with a 2% drift so it is not frozen
t+2.2   camera scale 1.0 → 0.62 over 1.3s, expo.out, and x/y toward the
        new subject, which is already composed and waiting
t+3.5   the line is now small in the corner of a wider world
```

The point is that the zoom and the retreat are one continuous gesture with a turn in the middle, and the destination is *new information*, not the shot you started in. Pulling back to exactly where you began is the wobble this vocabulary exists to avoid.

## The type treatment, and the two rules that stop it fighting itself

Editorial lines reveal **word by word, with focus resolving before travel**. Each word rises `y: 18 → 0` while its opacity comes up, and a *second, shorter* track takes it from `blur(5px)` to `blur(0px)` in about half the time. The word is therefore sharp while it is still moving, which is what makes the line read as type landing on a page rather than a caption fading up. Use `editorialTextReveal(timeline, line, { at, duration: 0.42-0.5, stagger: 0.08-0.11 })`, which runs exactly this.

Two failures follow from getting the timing around it wrong, and both look like the type is fighting itself.

**Nothing else animates the line until its last word has settled.** Compute it — do not estimate:

```
lastWordSettled = at + (wordCount - 1) * stagger + duration
```

A five-word line revealed at `0.08` with `stagger 0.075` and `duration 0.46` settles at **0.77s**. Starting the line's own scale, drift or push before that has the whole block moving while individual words are still travelling inside it, and the two motions visibly beat against each other. Every breathe, push and exit begins at or after `lastWordSettled`.

**Never animate `filter` on a line while its words still carry a filter.** The reveal animates blur on each word; blurring the parent on exit nests a second filter over the first, the browser composites the subtree twice, and the exit stutters. Clear the children first, at the exit's own start:

```js
const words = editorialTextReveal(t, line, { at: 6.3, duration: .42, stagger: .09 });
t.set(words, { filter: "none" }, 8.55);
t.to(line, { y: -320, filter: "blur(3px)", duration: .7, ease: "power3.in" }, 8.55);
```

The same holds for any property the reveal owns: the parent takes over only once the children have let go.

## Typography: use the built treatments

Choose one treatment per film; all three are callable presets. Use the preset rather than re-implementing it as an opacity fade:

- **The Pullback Complete** — `pullbackComplete(timeline, lead, tail, { camera, at, startScale, hold })`. One massive cropped line settles; the camera pulls back and the rest of the sentence slides into the room the retreat opened. Pass the `data-camera-world` element as `camera` so the retreat and the completion are one move. The tail element is hidden for you until the pullback.
- **Macro Settle** — `macroSettle(timeline, line, { at, startScale: 3, blur: 18 })`. Type arrives at 300% and heavily blurred, then snaps to crisp 100%. Focus resolves before the movement does; do not add your own blur tween.
- **Kinetic Anchor** — `kineticAnchor(timeline, anchor, rest, { at, distance, rotation })`. One word holds absolutely still while the rest of the line travels around it on alternating vectors. Author the anchor word as its own element; the preset never tweens it.

`macroSettle` and `kineticAnchor` return the split word elements, so you can hang a secondary action off them. `pullbackComplete` returns the timeline, not an array — destructuring it crashes the film. Check the return type in the runtime API reference before you index or spread any preset's result. Use exactly the treatment you chose.
