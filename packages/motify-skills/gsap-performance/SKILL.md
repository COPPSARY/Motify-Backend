---
name: gsap-performance
description: Read when a film is heavy or janky. Covers how to animate transforms and opacity, limit simultaneous tweens, batch work across many elements.
---

# GSAP Performance

> **Motify:** `runtime-contract` wins any conflict with this skill. You never call `gsap.to()`, `gsap.from()` or `gsap.timeline()` on their own: add every tween to the supplied `timeline` (`timeline.to`, `timeline.fromTo`, `timeline.set`) at explicit seconds. There is no ScrollTrigger, plugin, `matchMedia`, `ticker`, `onComplete` mutation or `repeat: -1`. Use `fromTo` with `immediateRender: false` so scrubbing stays deterministic.

## When to Use This Skill

Apply when optimizing GSAP animations for smooth 60fps, reducing layout/paint cost, or when the user asks about performance, jank, or best practices for fast animations.


## Prefer Transform and Opacity

Animating **transform** (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `rotationX`, `rotationY`, `skewX`, `skewY`) and **opacity** keeps work on the compositor and avoids layout and most paint. Avoid animating layout-heavy properties when a transform can achieve the same effect.

- ✅ Prefer: **x**, **y**, **scale**, **rotation**, **opacity**.
- ❌ Avoid when possible: **width**, **height**, **top**, **left**, **margin**, **padding** (they trigger layout and can cause jank).

GSAP’s **x** and **y** use transforms (translate) by default; use them instead of **left**/**top** for movement.

## Batch Reads and Writes

GSAP batches updates internally. When mixing GSAP with direct DOM reads/writes or layout-dependent code, avoid interleaving reads and writes in a way that causes repeated layout thrashing. Prefer doing all reads first, then all writes (or let GSAP handle the writes in one go).

## Many Elements (Stagger, Lists)

- Use **stagger** instead of many separate tweens with manual delays when the animation is the same; it’s more efficient.
- For long lists, consider **virtualization** or animating only visible items; avoid creating hundreds of simultaneous tweens if it causes jank.
- Reuse timelines where possible; avoid creating new timelines every frame.

## Reduce Simultaneous Work

- Pause or kill off-screen or inactive animations when they’re not visible (e.g. when the user navigates away).
- Avoid animating huge numbers of properties on many elements at once; simplify or sequence if needed.

## Best practices

- ✅ Animate **transform** and **opacity**; use **will-change** in CSS only on elements that animate.
- ✅ Use **stagger** instead of many separate tweens with manual delays when the animation is the same.
- ✅ Use **gsap.quickTo()** for frequently updated properties (e.g. mouse followers).

## Do Not

- ❌ Animate **width**/ **height**/ **top**/ **left** for movement when **x**/ **y**/ **scale** can achieve the same look.
- ❌ Set **will-change** or **force3D** on every element “just in case”; use for elements that are actually animating.
- ❌ Create hundreds of overlapping tweens without testing on low-end devices.
- ❌ Ignore cleanup; stray tweens keep running and can hurt performance and correctness.
