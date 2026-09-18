---
name: recoup-recovery-story
description: Use for high-stakes recovery or operations stories told with a persistent protagonist, real camera depth, and mechanism-first proof.
---

# Recovery story

Tell a mechanism-first story in which a persistent account, order, case, or record changes state, is at risk, then is visibly recovered.

- Give statements and interfaces separate frames; never stack campaign copy over a dense product shot.
- Use a real `preserve-3d` camera rig with authored depth and a floor or comparable depth reference.
- Make glass physical with radial hotspots tied to light, lit bevels, and restrained grain; never use diagonal reflection stripes.
- Keep one protagonist record across problem, mechanism, proof, and close. Change its state on the decisive frame.
- Keep the mechanism active, vary scale rhythm, and turn a carrier edge-on for true face swaps.


## Code authoring contract

Build `cameraRig` with `transform-style: preserve-3d`, a floor grid inside it, flat HUD type outside it, and a persistent `carrierCard` outside scene panels.
Represent the protagonist with explicit status actors (`active`, `pastDue`, `suspended`, `recovered`) and schedule exact state swaps beside the responsible mechanism event.
Animate reflection by CSS custom properties such as `--lx`, `--ly`, and `--a`; never animate a diagonal background gradient as glass shine.
```js
timeline.to(cameraRig, { z: 1212, duration: 2.4, ease: EASE.cameraRamp }, mechanismAt);
```

Verify authored depth remains legible during the fly-through, every retry resolves in order, and the success colour change happens on recovery.
