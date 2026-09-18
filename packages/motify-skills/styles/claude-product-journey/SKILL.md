---
name: claude-product-journey
description: Use for a polished AI product journey from prompt, through visible processing, to cross-device payoff.
---

# AI product journey

Stage one believable interaction: prepare a prompt, submit, show processing, reveal a useful result, then prove continuity on a second device.

- Build a credible product surface with navigation, composer, response region, and only action-relevant controls.
- Cursor actions must cause state changes: hover, press, input docks, placeholder clears, text appears, and submit responds.
- Push into commitment, pull back for readable result, keep processing continuous, and level any 2.5D result before inspection.

Use `EASE.travel` for camera follow-pans, `EASE.material` for docking, and one continuous pullback to the final line.

## Code authoring contract

Create `sidebar`, `composer`, `attachment`, `cursor`, `thinking`, `resultCard`, `mobile`, and `cameraWorld` actors; hide all non-opening states at time 0.
Model input as state changes: cursor reaches target, attachment docks, placeholder hides, typed string advances, send compresses, then thinking begins.
Keep the result card and camera in separate wrappers so 2.5D generation tilt can settle flat before the readable reveal.
```js
timeline.to(cameraWorld, { scale: 1.35, x: 80, duration: 1.1, ease: EASE.cameraRamp }, resultAt);
```

Verify the composer has one image only, the border/progress loop stays continuous, and desktop/mobile show the same result state.
