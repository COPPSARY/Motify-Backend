# Motionly promo reference

This directory mirrors the frontend `motionly-promo` preset for backend authors and evaluation. It is reference material only; generated projects must use the four canonical source files and must not import from this directory.

Useful patterns to study:

- `composition.html`: semantic scene layers, CSS variables, restrained background hierarchy, editorial type, stable `data-edit` ids, and product UI surfaces.
- `timeline.js`: explicit initial state, caller-owned GSAP timeline, word/character reveals, persistent morph carriers, camera movement, readable holds, and final cleanup.
- `index.ts`: thin metadata and mounting adapter with truthful scene and track timing.
- `timing.ts`: duration and retiming relationship.
