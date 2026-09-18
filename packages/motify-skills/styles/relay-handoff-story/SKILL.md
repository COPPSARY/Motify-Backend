---
name: relay-handoff-story
description: Use for collaborative review, approval, and delivery stories driven by one persistent artefact travelling between people.
---

# Handoff story

Choose one artefact that survives review, handoff, delivery, and brand resolution.

- Start with questions around the artefact, converge them into concrete review rows, and make approvals happen in meaningful order.
- Fold the approved artefact into its delivery form, move it on a visible arc, then open it into the same approved content.
- Keep the continuity owner outside transient scenes and animate its outline, faces, and perspective on the caller-owned timeline.

Use `motionArc` for travel, `EASE.material` for folding, and `matchCut` only for shared geometry.

## Code authoring contract

Create a persistent `handoffArtefact` outside `review`, `approval`, `travel`, and `delivery` scenes; animate its front, back, and outline as one actor.
Build review rows on the artefact itself, then replace status icons in order before a readable approval hold.
Fold the artefact into a packet before motion; make the same packet travel and open into the approved version, not a substitute panel.
```js
motionArc(timeline, handoffArtefact, { endX: 760, endY: 120, arcHeight: 160, at: travelAt, duration: 1.1, ease: EASE.travel });
```

Verify the artefact never disappears at a seam, the travel arc stays in frame, and delivery contains the approved content.
