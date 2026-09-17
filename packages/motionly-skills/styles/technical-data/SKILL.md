---
name: technical-data
description: Use for developer, data, analytics, and finance product films.
---

# Technical data product film

Use a deep focused ground, precise information hierarchy, meaningful charts or
code-like evidence, and disciplined motion. Avoid consumer glass, playful
decoration, and generic marketing-card layouts.

## Motify reference pattern

Use Motify's `tessera` preset as the implementation model: persistent records
move through a visible transformation, their field names and values change
together, and each resolved record receives a reserved output position. Do
not copy its contract terminology, colours, values, or card geometry.

```js
// Move the same record through processing, then park it before the next arrives.
timeline.to(activeRecord, { z: 0, y: 0, duration: 0.8, ease: EASE.travel }, 5.2);
timeline.to(activeRecord.querySelector('.status'), { textContent: 'Validated', duration: 0.01 }, 6);
timeline.to(activeRecord, { x: 470, y: -160, scale: 0.78, duration: 0.75, ease: EASE.arrive }, 6.25);
```

Show real relationships: a source becomes a normalised record, a query affects
a chart, or a threshold changes a status. Keep numbers internally consistent.
Use depth only when it communicates processing order; stop the camera at proof
moments so values, labels, and code can be read without a cropped pan.
