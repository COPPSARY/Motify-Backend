---
name: editorial-brutalist
description: Use for bold editorial, poster-like, and high-contrast product films.
---

# Bold editorial product film

Use high contrast, oversized type, decisive asymmetry, hard-edged panels, and
deliberate cuts. Let typography or a single graphic device carry the frame.

Avoid glass, soft gradients, rounded dashboard cards, and the default SaaS-launch
look unless the request explicitly requires them.

## Motify reference pattern

Derive the film grammar from Motify's `relay` preset: one persistent artefact
owns the story. A brief, poster, package, or product object should collect the
decision, change material, travel, and resolve into the mark. Do not copy the
paper packet, coral palette, or Relay copy.

```js
// A real carrier crosses the cut; type stays at a readable editorial scale.
timeline.to(carrier, { x: 760, rotateZ: -5, duration: 1.1, ease: EASE.travel }, 8);
timeline.fromTo(nextFrame, { x: 160, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.7, ease: EASE.arrive }, 8.25);
editorialTextReveal(timeline, headline, { at: 9, duration: 0.48, stagger: 0.085, distance: 24, blur: 2 });
```

Give copy its own frame or give the interface its own frame; never make the
viewer read both at once. Use one hard visual decision per beat: a crop, a
stamp, a fold, a colour inversion, or a graphic lockup. Adjacent beats must
change scale or framing, not merely replace the sentence.
