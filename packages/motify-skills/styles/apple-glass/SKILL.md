---
name: apple-glass
description: Use for refined Apple-like and premium consumer product films.
---

# Refined Apple-like consumer product film

Use luminous wallpaper, restrained liquid glass, precise typography, considered
negative space, and calm tactile motion. Avoid busy charts, dense tables, and
loud decorative effects.

## Motify reference pattern

Follow the scene grammar in Motify's `apple-notesapp` preset: a small human
input becomes one organised product surface, then persists across devices or
contexts before resolving into a simple outcome. Use the user’s product and
assets, not Notes branding, yellow paper, or Apple copy.

```js
// Build a refined surface in reading order, then carry one signal into the next beat.
timeline.fromTo([sidebar, list, editor], { y: 20, autoAlpha: 0 }, {
  y: 0, autoAlpha: 1, duration: 0.52, stagger: 0.1, ease: EASE.arrive,
}, 5);
timeline.to(sharedSignal, { x: 620, scaleX: 1.4, duration: 0.9, ease: EASE.travel }, 8.1);
timeline.to(deviceGroup, { rotateY: -5, z: 40, duration: 1.1, ease: EASE.material }, 8.1);
```

Reserve negative space around one fully readable surface. Glass is a material
with a contained highlight and subtle depth, not a translucent rectangle over
every element. Use tactile feedback sparingly: one press, pencil stroke, or
selection response per beat is more convincing than continuous floating.
