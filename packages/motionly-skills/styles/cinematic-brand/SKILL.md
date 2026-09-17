---
name: cinematic-brand
description: Use for story-led, luxury, fashion, music, and brand films.
---

# Cinematic brand film

Build around an emotional visual metaphor, strong contrast, expressive pacing,
and one memorable hero object or scene. Do not default to an application window
or SaaS dashboard when the product can be communicated more directly.

## Motify reference pattern

Use Motify's `recoup` preset as the story model: establish a meaningful state
that can be lost, show the mechanism changing it, prove the recovered state,
and land on the brand. The carrier should survive that chain. Do not copy its
payment-recovery story, figures, glass panels, or magenta/green palette.

```js
// A hero object changes state; camera motion follows its consequence.
timeline.to(hero, { rotateY: 180, z: 220, duration: 1.05, ease: EASE.material }, 8);
timeline.to(cameraWorld, { z: 360, duration: 1.2, ease: EASE.cameraRamp }, 8.15);
timeline.fromTo(proof, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.7, ease: EASE.arrive }, 10);
```

Alternate statement frames with mechanism frames rather than placing a slogan
on top of a busy interface. Use a light source, surface, or landscape that
makes camera travel legible. Each seam must carry the hero object, its material,
or its consequence into the next beat; never clear the stage to transition.
