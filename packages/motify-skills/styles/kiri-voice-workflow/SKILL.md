---
name: kiri-voice-workflow
description: Use for voice, language, or audio-product films where one audio actor connects creation, review, transcription, and export.
---

# Voice workflow

Make a shared audio signal the continuity owner from script through generated speech, review, transcription, and export.

- Respect supplied local-language text and fonts; never replace a supported script with transliterated placeholder copy.
- Construct the editor face-on, tilt it only gently for reading, and keep waveform or audio outside transient scene containers.
- Let one active voice, speaker, or setting drive a credible list and show downstream proof from the same audio actor.

Use `EASE.arrive` for UI construction, `EASE.travel` for audio handoffs, and `EASE.material` for role changes.

## Code authoring contract

Create `editor`, `voicePicker`, `waveform`, `profiles`, `transcript`, `exports`, and `mark`; keep `waveform` and `mark` outside temporary scenes.
Use all supplied choice labels in the picker and animate selection, generation, speaker assignment, and export from the same audio state.
Use explicit `fromTo` destinations for a reused logo and audio strip so a reverse seek restores no earlier geometry.
```js
timeline.to(waveform, { y: -140, duration: 1.15, ease: EASE.travel }, profilesAt);
```

Verify language glyphs use available fonts, every exit has duration, and the audio workflow reads without audio playback.
