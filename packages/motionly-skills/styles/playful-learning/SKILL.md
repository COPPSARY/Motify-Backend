---
name: playful-learning
description: Use for friendly education, children, and playful consumer products.
---

# Playful learning product film

Use bright friendly colour, generous whitespace, rounded tactile objects,
illustrated cues, and encouraging progress moments. Prioritize clarity and
delight over dense product chrome or an enterprise dashboard.

## Motify reference pattern

Use Motify's `KiriTTS` preset as a structural reference: introduce one clear
idea, show credible inputs arriving, reveal the product action in reading
order, then make the helpful result feel earned. Adapt the causal sequence to
the product; never reuse KiriTTS copy, assets, or its voice-product layout.

```js
// Let related learning objects arrive as a small, readable group.
timeline.fromTo(cards, { y: 70, scale: 0.82, autoAlpha: 0 }, {
  y: 0, scale: 1, autoAlpha: 1, duration: 0.62,
  stagger: 0.12, ease: EASE.arrive,
}, 3.2);
timeline.to(progressFill, { width: '78%', duration: 0.8, ease: EASE.material }, 4.3);
```

Use three to five chunky, named objects rather than an unbounded confetti of
badges. Colour should encode progress, success, and the next action. Keep one
friendly focal subject large enough to read, and let each interaction produce
a visible result before the next one begins.
