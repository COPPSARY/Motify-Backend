# Look and shot design: the reference standard

Supporting file of the write-motify skill. Read it only when the skill says it applies to this request.

## SaaS advertising direction

### Continuity and readable proof: lessons from preset review

Treat examples as a library of mechanisms, not finished layouts to copy. KiriTTS demonstrates a selected voice producing audio that persists after its editor leaves; Tessera demonstrates source fields resolving into a shared contract. Reuse the causal action for the current product, not its card count, copy, palette, or camera schedule.

Relay provides a third direction: a warm-paper editorial film with no browser shell and no giant-type opening. Questions around a brief converge into review rows, checks resolve on that same brief, an approval stamp lands, and the paper folds into a packet. The camera trails the packet's lateral arc to a receiving tray, where it opens into the approved brief. The brief finally becomes the mark. This is useful for review, approval and handoff products; it is not a universal envelope metaphor. Its distinguishing construction is one persistent artefact, a visible decision, then a journey caused by that decision. Keep shallow perspective during a reading shot (roughly 3-8 degrees), settle controls near face-on for interaction, and put travel on the artefact before the camera follows. Reserve separate layout space for outputs: an audio player must sit below editing controls with a real gap, not float across them.

- Give every reused actor a complete destination state: position, size, radius, scale, rotation, surface and content. In a late GSAP `fromTo`, properties supplied only in `fromVars` can animate back to values captured from an earlier use. Repeat fixed geometry in `toVars`, use `immediateRender: false`, and verify first playback as well as end -> start -> middle seeks. A 300px logo must not return as the 1660px panel it previously became.
- Reserve the incoming subject's reading area. Let outgoing text finish travelling or fading before new text enters that area. A persistent waveform can bridge two shots while the surrounding editor exits. Do not rotate a whole application through the foreground or cover the next shot with an empty morph plate.
- Select representative proof. A thirteen-option library belongs in the actual picker; the advertising beat can show the selected voice and two readable alternatives. Do not cram a full feature catalogue into a short hold. Show one or two capabilities doing something: text and voice becoming audio, highlighted text gaining a read-aloud player.
- Give processed records separate destinations. At a processing gate, admit one readable record, change its own fields, then move it into a reserved output slot before the next record arrives. Never park overlapping cards in the gate or crop the final comparison without a story reason.
- Use camera travel to follow a specific action, then decelerate and allow reading. Avoid simultaneous world rotation, card rotation, scaling and lateral travel on a handoff. Vary the action and composition before adding another zoom.
- Every visible exit needs elapsed time. A later `set(autoAlpha: 0)` is safe only after its actor is already invisible or outside the frame. Validate seams before, during and after the handoff, with real projected bounds and text contrast. Inspect forward playback, cold seeks and reverse seeks; source-level timeline tests alone cannot catch a giant blank tile or unreadable overlap.

User-specified slide, fade and continuous-action handoffs are valid creative choices. Preserve a clear subject and spatial continuity; do not force an unnecessary shape morph into every boundary. Stable baseline word reveals with early focus are the default for readable copy; oversize pullbacks and overshoot are deliberate accents, not requirements on every sentence. Never claim a render or live generation was reviewed unless it was actually inspected.

The target is an authored SaaS ad with varied shots. Product UI is useful evidence when it shows a concrete action and its result. A full application window sitting on screen while its copy changes is not an ad structure.

For a general SaaS ad, build a shot progression from the request: editorial hook -> product material or problem -> mechanism close-up -> visible result -> brand. Adapt the number and order to the story; do not reuse this as a fixed template. Two adjacent beats must differ in framing and in what visibly happens. Alternate wide, medium, and detail views with a reason for each move.

- The ground is a lit space, never flat `#ffffff`: warm off-white with a blurred brand-hue bloom behind the subject, warm neutral grey, near-black with one warm source, or a full-bleed brand colour. Use the supplied product identity or explicit user palette when present. Dark is a deliberate contrast beat, not a synonym for premium.
- Make the subject large enough to read. An isolated icon or control may occupy 25-45% of frame height; a proof artifact may occupy 55-80% of frame width. Compose around the focal subject rather than padding every shot with cards.
- One editorial sentence per thought, centred, weight 700, tracking -0.03em to -0.055em. Size it for the beat, not to a rule: a quiet opener sits at 25-35% of frame width (about 76-90px at 1080), a dramatic beat at 60-75% (about 180-215px), and a close at 20-30%. Settle word-by-word with back.out(1.35). Colour exactly one word in the brand hue. Never add a smaller explanatory subtitle beneath it.
- A useful UI close-up may span an input and its result. Show the active detail, then leave it. Do not repeat sidebars, top bars, empty panels, generic response lists, and invented KPI tiles across scenes.
- Show actual proof: the edited word, organized tasks, built scene, completed document or generated image. Never invent 98% success, 12ms latency, or 10x ROI as decoration. Attached images are each labelled in the message, and the labels mean opposite things. An "asset to place in the film" is content: use each one, by its exact token. A "reference to imitate" is a screenshot, storyboard or style reference: read the layout, type, spacing, palette and product chrome it shows and rebuild that faithfully in authored HTML/SVG, and never put it on screen, even though a token is listed beside it. A "frame" is a rendering of the candidate you are repairing: diagnose it, never reproduce it. With none attached, use honest authored HTML/SVG material rather than fake image placeholders or invented asset URLs.
- During a reading hold, let a meaningful secondary action or bounded camera movement continue. Tiny global drift cannot substitute for the scene's primary action. Shorten a beat whose work is already complete.
- End on a prominent mark and a short promise on open or full-bleed brand ground. Do not put the ending inside a small rounded pill.

Borrow the reference shot design while obeying Motify's MORPH, MATCH-CUT and PARTICLE-REASSEMBLE boundary rules. Recreate any reference edit that would break continuity with a real shared carrier.

## The reference standard

Seven published product films were studied frame by frame for this skill. You cannot watch them, so everything they do is written out below as construction you can execute. This is the bar. A film that does none of it is not a product film, it is a slide deck.

The single most common gap between generated output and these films is **scale and depth**. The references put one enormous thing on screen at a time, in a lit space with a real ground. Generated output puts four small rounded rectangles on flat white. Fix that first; everything else is detail.

### The ground is a lit space, never flat white

Not one of the seven uses plain `#ffffff`. Every ground is one of four kinds, and each carries light:

1. **Warm off-white with a coloured bloom.** Ground `#F6F5F8`–`#EFEEF3`. Behind the focal object sits one or two soft radial glows in the brand hue at 25–45% opacity, 500–900px across, heavily blurred (`filter: blur(80px)` on an absolutely positioned circle). The frame reads as lit, not blank.
2. **Warm neutral grey.** Ground `#E8E6E3`–`#EDEBE8`, no gradient, extremely restrained. Used when the content is photographic and must not compete.
3. **Near-black with a single warm source.** Ground `#0B0B0D`–`#141318`, with one large radial gradient in the brand hue (orange, purple, red) bleeding from one edge or from behind the type at 30–60% opacity. Type on this ground carries a soft glow: `text-shadow: 0 0 40px <accent at 45%>`. Optionally a fine grain overlay at 3–6% opacity.
4. **Full-bleed brand colour.** The entire viewport floods to one saturated brand colour — a coral `#EE4B3C`, a blue `#1A56F0`, a deep red — with white type. Held 1.5–2.5s. Use at most twice per film, as punctuation or as the final beat.

The ground never changes to white, never goes transparent, and never empties. When the film moves between grounds it does so as a full-bleed wipe or flood driven by an object, never a fade.

### Typography

**Family.** A geometric or neo-grotesque sans throughout: `Inter`, `Söhne`, `General Sans`, `Satoshi`, or the platform stack `-apple-system, "SF Pro Display", Inter, sans-serif`. One family per film. Serif appears only if the brand's own wordmark is a serif.

**Weight and tracking.** Statements are 600–780 weight with tight negative tracking, `letter-spacing: -0.03em` to `-0.055em`. Never a light weight for a statement. Never letter-spaced-out uppercase except for a kicker.

**Size varies enormously, and the variation is the point.** Measured frame by frame in one reference film: a quiet opening statement spans **25% of frame width** (~5% cap height, about 76px at 1080); a dramatic beat spans **69%** (~14% cap height, about 210px); the brand close spans **20%**. Three statements in one film, and the largest is three times the smallest.

So there is no single correct size, and setting every statement large is a real failure mode — it crowds the frame, leaves nothing for the object beats, and flattens the film into one loud note. Choose per beat:

| The beat | Share of frame width | About, at 1080 |
| --- | --- | --- |
| A quiet opener or a connective line | 25–35% | 76–90px |
| The one beat that has to land | 60–75% | 180–215px |
| The brand close | 20–30% | 60–90px |

**The oversized moment comes from the camera, not the type.** In the reference the line that fills the frame edge to edge is a *normal* statement with a camera pushed into it — it starts at reading size, the camera pushes until the words are cropped by both edges, and then it settles back. Set the type modestly and let the push do the work.

**One thought, one line, no subtitle.** Every statement is a single sentence or fragment, centred, with nothing under it. A second line of smaller grey explanatory text under a headline appears in none of the seven and is the clearest signal of generated output.

**The accent word.** Almost every statement colours exactly one word in the brand hue while the rest stays near-black or white: *"So, progress **slows**"* with `slows` in blue; *"Where the world builds **software**"* with `software` in purple; *"Select your desired **style**"* with `style` in red; *"All **connected**"*, *"Everywhere at **once.**"*. Two-tone within a single line, one accent word, never more.

**Words arrive one at a time onto a fixed line.** A recurring construction: `Ideas.` holds, then `Notes.` appears beside it, then `Tasks.` — the line assembling in place with the earlier words never moving. Similarly `Translate.` → `Dub.` → `Distribute.` Build this by laying out all words in the final position and revealing each with a `y: 24 → 0` plus opacity on `back.out(1.4)`, 0.35–0.5s apart. Do not re-centre the line as words appear.

**Punctuation as design.** Statements frequently end in a full stop that is itself an object — `Ideas.` `Books.` `Done.` — and a small four-point sparkle glyph `✦` sometimes closes a line.

**Objects carry the film; type punctuates it.** The reference is mostly *things*: a solid app icon alone at 25-30% of frame height, a phone tilted in perspective with real app icons orbiting it, a blue dimensional ribbon curving through the frame, eight content cards at depth with the camera flying through them, coloured pills with a title, a subtitle and a small icon. Between those, a short statement holds for a second and a half and then gets out of the way. If your film is statements with material underneath them, you have it backwards: alternate an object beat and a type beat, and let the objects have the screen time.

### The shot catalogue

These are the shots the references are actually built from. Pick four to six per film; every one of them is a large, single-subject composition.

**Full-bleed imagery under type.** A photograph, map, or texture fills the entire viewport and a very large statement sits over it in white or black. Nothing else in frame. This is the strongest opening in the set.

**The 3D application panel.** The product UI is not a flat rectangle in the middle. It is a large panel rotated in three dimensions — `perspective: 1600px` on the world, `rotateY: 12–26deg`, `rotateX: 4–10deg`, `rotateZ: -3–6deg` — occupying 60–95% of frame width, with a real drop shadow (`0 60px 140px rgba(0,0,0,.28)`) and often bleeding off one edge of the frame. Two or three such panels at different depths and angles, with the camera travelling past them, is a standard beat.

**A corridor of material at depth.** Five to nine real objects — document pages, code planes, PR cards, content thumbnails — placed at distinct Z depths from `translateZ(-1400px)` to `translateZ(300px)`, each with its own slight rotation, the nearest ones motion-blurred. The camera flies forward through the corridor. Every object carries genuine content: a real title, a real status pill, real body text. This shot replaces "some cards fade in".

**The dimensional icon or device.** One app icon, phone, or artefact rendered as a solid object at 25–45% of frame height, tilted in perspective with a soft contact shadow, slowly rotating. Around it, five or six smaller related icons orbit on elliptical paths at varying depth.

**Icons used as words.** A 3D icon sits inline inside a sentence at the same optical size as the type — *"Any language [folder icon] Instantly"* — and can then be dragged by a cursor out of the line and into a drop target. Icons are solid, dimensional, and lit, never flat monoline glyphs.

**The macro edit.** Extreme close-up on a single word or control filling 30–60% of frame width, with a text selection highlight sweeping across it, a caret blinking, or a value changing in place. The camera pushes in to reach it and pulls back out.

**The rolling picker.** A vertical list of eight to twelve real option names in light grey, scrolling continuously, with the currently selected one snapping to full black at the anchor line and a small marker beside it. Reads as a machine choosing.

**Coloured status pills.** Rounded-full chips — `border-radius: 999px`, `padding: 10px 22px` — in saturated brand colours with white or dark text, each often carrying a small icon. Stacked in a column with 0.08s stagger, or connected by thin curved lines into a node graph.

**The measured number.** One large figure at 8–14% of frame height with a unit and a period beside it, counting up, above a gradient-filled progress bar that fills in sync. Never an unlabelled sparkline.

**The real terminal or timeline.** Monospace output in a dark window with traffic-light dots, lines appearing one at a time with checkmarks; or a video editor timeline with layered filmstrip and waveform tracks in distinct colours, a playhead, and real timecodes.

**Geometry as metaphor.** Three large translucent circles in cyan, magenta and amber overlapping so the intersections blend additively; a soft multi-hue gradient sphere; an iridescent faceted form rotating slowly on black. Pure geometry at 30–50% of frame height, used where a UI would say nothing.

**The brand close** (one ending among several, not the default). The mark and wordmark together, centred, occupying 25–40% of frame width, on open ground or a full-bleed brand colour, with at most four words under it or a bare URL. In one film the mark substitutes for a letter in the final word. The close is never a small pill and never a paragraph.

### Camera

The camera is a real instrument in every one of these films and it never stops.

- **Push in** on the subject: `scale 1 → 1.35–1.8` over 1.2–2.0s, `expo.out` or `power4.out`.
- **Pull back to reveal**: `scale 1.6 → 1` while the frame fills with what was outside it. This is the reveal move, and it is how a sentence completes itself.
- **Lateral travel**: `x` moving 600–2400px through a wide `data-camera-world` at `power2.inOut`, following material rather than sliding for its own sake.
- **Z-push through depth**: the world's `translateZ` advancing while layered objects pass the camera and blur.
- **Orbit**: the world rotating 8–20deg on Y around a fixed subject.
- **A settling drift** under every reading hold: 1–3% scale or 10–30px of travel, continuing, so no frame is ever locked.

Adjacent beats contrast in *framing* — a macro follows a wide, a full-bleed follows a detail. They do not have to contrast in camera move, and alternating push with pull to manufacture contrast is the failure this rule is most often turned into. Most beats need no camera move at all.

### Transitions between beats

Every boundary in these films is carried by an object. The four that actually appear:

1. **Object-led wipe.** A large shape, panel, or colour field sweeps across the frame in one direction and the next beat is already composed behind it. The wipe is the carrier.
2. **Camera-continuous cut.** The camera is already travelling; the material changes while the movement's axis, direction and speed are preserved across the boundary, so the eye reads one continuous move.
3. **Morph of the shared object.** A card becomes a window becomes a panel — one element whose width, height, radius and surface change continuously while its contents cross-fade inside it.
4. **Scatter and reform.** A cluster of objects breaks apart on individual vectors with rotation and motion blur, travels, and reassembles as the next beat's composition.

Never a cross-dissolve, never a fade through white or black, never a hard cut between two unrelated static layouts.
