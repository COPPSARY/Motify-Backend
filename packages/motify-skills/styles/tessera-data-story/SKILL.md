---
name: tessera-data-story
description: Use for data normalization, integration, or transformation stories where the same records persist from messy inputs to comparable outputs.
---

# Data transformation story

Make transformation visible through persistent records from messy inputs to readable, comparable outputs.

- Give the opening claim and processing mechanism separate frames; use depth for inputs and reserved flat destinations for results.
- Move field labels and values together as one record normalises; keep one record at reading focus while others remain composed.
- End on a contained comparison where every completed record fits in frame, then converge those same records into the close.

Use `EASE.cameraRamp` for source depth, `EASE.arrive` for normalisation, and `EASE.material` for convergence.

## Code authoring contract

Create five persistent record actors with child field-label and field-value rolls, plus `corridor`, `gate`, `completedGrid`, and `mark` actors.
Keep the corridor in depth while editorial type stays in a flat HUD; stop the camera at the gate and move the records through it one at a time.
For each record, change field label and value rolls together, then move the same actor to a reserved completed-grid slot.
```js
timeline.to(record, { x: slot.x, y: slot.y, z: 0, duration: 0.72, ease: EASE.travel }, resolveAt);
```

Verify all five completed records fit at the comparison frame and every record can converge into the close without replacement.
