---
name: apple-notes-workflow
description: Use for warm, tactile productivity films that turn scattered capture into an organised, cross-device next step.
---

# Apple Notes workflow

Tell a calm cause-and-effect story: fragments converge into one capture surface, the workspace makes them actionable, and a tactile step completes them.

- Use warm paper, graphite neutrals, one product accent, and one ink carrier; use supplied branding only.
- Construct navigation, list, editor, then active control in reading order; keep product surfaces readable.
- Persist one note or ink stroke across capture, organisation, device sync, and completion; morph it instead of using decoration.

Use `EASE.material` for the note or ink changing form and `EASE.arrive` for assembled UI.

## Code authoring contract

Create `capture`, `workspace`, `devices`, and `completion` actors plus one persistent `inkCarrier` outside those beat containers. Give every editable label a `data-edit` id.
Set all hidden actors at timeline time 0; build the workspace in reading order and explicitly set the note's final dimensions before every reuse.
Use a caller-owned timeline?never callbacks or CSS-only completion?to move the carrier from underlined claim to capture point to synced note.
```js
timeline.to(inkCarrier, { ...notePose, duration: 0.8, ease: EASE.material }, 3.2);
```

Verify settled frames for a readable workspace, three uncropped devices, and forward/reverse seeking with no stale note geometry.
