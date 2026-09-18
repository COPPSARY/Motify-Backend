---
name: motify-launch-film
description: Use for premium SaaS launch films that move from a sharp problem to an editable product workflow and a clean brand close.
---

# Premium launch film

Use a launch spine: problem, cost, product introduction, command becoming workspace, proof, then minimal CTA.

- Alternate editorial type frames with product frames so viewers never read a headline and dense interface together.
- Use a persistent morph shell from input to product surface to brand token; the carrier owns every handoff.
- Show typed input, a responsive control, generation, and editable product details as causal states.

Use `editorialTextReveal`, `morph`, and `cutTheCurve` only where they match that causal handoff.

## Code authoring contract

Create separate editorial, prompt, workspace, proof, and close beat containers plus a persistent `morphShell` with prompt, surface, and token faces.
Use `data-edit` for the user-facing claim, prompt text, active control, and CTA; mount real interface rows rather than a lone placeholder card.
At time 0, set all faces and transition actors. Swap shell faces only when the shell is edge-on or fully covered by its own material transition.
```js
morph(timeline, morphShell, workspacePose, { at: generateAt, duration: 0.9, ease: EASE.material });
```

Verify each editorial frame contains no product surface, each product frame has a readable focal action, and the close holds.
