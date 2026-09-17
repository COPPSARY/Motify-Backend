export interface QualityStarterProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export function createQualityStarterSource(settings: QualityStarterProjectSettings) {
  const title = JSON.stringify(settings.name);
  const duration = Number(settings.duration);
  return {
    'composition.html': `<template id="motify-template">
  <main class="motify-stage" data-edit="stage">
    <div class="ambient ambient-a" data-edit="ambient-a" aria-hidden="true"></div>
    <div class="ambient ambient-b" data-edit="ambient-b" aria-hidden="true"></div>
    <div class="grid" data-edit="grid" aria-hidden="true"></div>
    <div class="topline" data-edit="topline">
      <span class="eyebrow" data-edit="eyebrow">MOTIFY / ORIGINAL</span>
      <span class="counter" data-edit="counter">01</span>
    </div>
    <section class="hero-beat" data-edit="hero-beat" aria-label="Main statement">
      <p class="kicker" data-edit="kicker">MAKE THE IDEA MOVE</p>
      <h1 data-edit="headline">Turn a sharp idea into a <span>living story.</span></h1>
      <p class="subline" data-edit="subline">A code-first canvas for expressive product films.</p>
    </section>
    <section class="proof-panel" data-edit="proof-panel" aria-label="Product proof">
      <div class="panel-header"><span class="status-dot"></span><span data-edit="panel-label">EDITABLE WORKSPACE</span><span class="panel-time" data-edit="panel-time">00:08</span></div>
      <div class="panel-body">
        <div class="panel-copy"><span class="panel-number">02</span><strong data-edit="proof-title">Prompt it. Shape it. Ship it.</strong><span data-edit="proof-copy">Every layer stays yours.</span></div>
        <div class="bars" data-edit="bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
    </section>
    <section class="closing-beat" data-edit="closing-beat" aria-label="Closing statement">
      <div class="mark" data-edit="mark" aria-hidden="true"><svg viewBox="0 0 80 80" role="presentation"><path d="M18 18h44v44H18z"/><path d="M29 29h22v22H29z"/></svg></div>
      <p class="closing-label" data-edit="closing-label">YOUR NEXT FRAME</p>
      <h2 data-edit="closing-headline">Make it unmistakably yours.</h2>
    </section>
    <div class="footer-line" data-edit="footer-line"><span>CREATE / EDIT / REPEAT</span><span>(C) MOTIFY</span></div>
  </main>
</template>`,
    'styles.css': `:root { color-scheme: light; }
.motify-stage { position: relative; width: 100%; height: 100%; overflow: hidden; isolation: isolate; color: #17202b; background: #f4f0e7; font-family: Georgia, 'Times New Roman', serif; }
.motify-stage * { box-sizing: border-box; }
.ambient, .grid { position: absolute; inset: 0; pointer-events: none; }
.ambient { z-index: -2; border-radius: 50%; filter: blur(70px); opacity: .75; transform-origin: center; }
.ambient-a { width: 58%; height: 84%; left: -15%; top: 28%; background: #87d9c8; }
.ambient-b { width: 52%; height: 72%; right: -10%; top: -16%; background: #f2a08b; }
.grid { z-index: -1; opacity: .24; background-image: linear-gradient(#17202b18 1px, transparent 1px), linear-gradient(90deg, #17202b18 1px, transparent 1px); background-size: 54px 54px; mask-image: linear-gradient(to bottom, transparent, #000 16%, #000 82%, transparent); }
.topline, .footer-line { position: absolute; left: 7%; right: 7%; display: flex; justify-content: space-between; align-items: center; color: #17202bb8; font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: .16em; }
.topline { top: 7%; } .footer-line { bottom: 6%; font-size: 11px; letter-spacing: .12em; }
.counter { color: #e4614e; font-variant-numeric: tabular-nums; }
.hero-beat, .closing-beat { position: absolute; left: 50%; top: 50%; width: min(78%, 1180px); transform: translate(-50%, -50%); text-align: center; }
.kicker, .closing-label { margin: 0 0 26px; color: #e4614e; font-family: Arial, sans-serif; font-size: 15px; font-weight: 800; letter-spacing: .22em; }
h1, h2 { margin: 0; font-weight: 500; letter-spacing: -.055em; line-height: .98; }
h1 { font-size: clamp(58px, 7vw, 132px); } h1 span { color: #e4614e; font-style: italic; }
.subline { margin: 32px 0 0; color: #17202b99; font-family: Arial, sans-serif; font-size: 19px; letter-spacing: .02em; }
.proof-panel { position: absolute; left: 50%; top: 50%; width: min(72%, 1080px); min-height: 310px; padding: 24px; border: 1px solid #ffffffc7; border-radius: 22px; background: #ffffffa8; box-shadow: 0 30px 90px #17202b18, inset 0 1px #fff; backdrop-filter: blur(18px); transform: translate(-50%, -50%); }
.panel-header { display: flex; align-items: center; gap: 11px; padding-bottom: 18px; border-bottom: 1px solid #17202b18; color: #17202b9e; font-family: Arial, sans-serif; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
.status-dot { width: 9px; height: 9px; border-radius: 50%; background: #2cae78; box-shadow: 0 0 0 5px #2cae7824; } .panel-time { margin-left: auto; font-variant-numeric: tabular-nums; }
.panel-body { display: flex; align-items: end; justify-content: space-between; gap: 40px; min-height: 225px; padding: 28px 12px 8px; }
.panel-copy { display: grid; gap: 12px; } .panel-number { color: #e4614e; font-family: Arial, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: .12em; }
.panel-copy strong { max-width: 560px; font-size: clamp(34px, 4vw, 68px); font-weight: 500; letter-spacing: -.05em; line-height: 1; } .panel-copy span:last-child { color: #17202b99; font-family: Arial, sans-serif; font-size: 16px; }
.bars { display: flex; align-items: end; gap: 9px; height: 130px; } .bars i { display: block; width: 22px; border-radius: 12px 12px 3px 3px; background: #e4614e; } .bars i:nth-child(1) { height: 34%; opacity: .35; } .bars i:nth-child(2) { height: 55%; opacity: .48; } .bars i:nth-child(3) { height: 76%; opacity: .62; } .bars i:nth-child(4) { height: 92%; opacity: .78; } .bars i:nth-child(5) { height: 66%; opacity: .52; }
.closing-beat { width: min(80%, 1200px); } .mark { width: 82px; height: 82px; margin: 0 auto 34px; color: #f4f0e7; } .mark svg { width: 100%; height: 100%; fill: none; stroke: #e4614e; stroke-width: 5; } h2 { font-size: clamp(54px, 6.5vw, 122px); }
@media (max-width: 700px) { .topline, .footer-line { left: 6%; right: 6%; font-size: 9px; } .hero-beat, .closing-beat { width: 88%; } .proof-panel { width: 86%; min-height: 260px; padding: 16px; } .panel-body { min-height: 190px; padding: 20px 4px 4px; } .bars { gap: 4px; transform: scale(.72); transform-origin: right bottom; } .subline { font-size: 15px; } }
`,
    'timeline.js': `import gsap from 'gsap';

export function buildTimeline({ root, timeline, register }) {
  const query = (selector) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error('Starter element was not found: ' + selector);
    return element;
  };
  const stage = query('[data-edit="stage"]');
  const ambientA = query('[data-edit="ambient-a"]');
  const ambientB = query('[data-edit="ambient-b"]');
  const grid = query('[data-edit="grid"]');
  const hero = query('[data-edit="hero-beat"]');
  const proof = query('[data-edit="proof-panel"]');
  const closing = query('[data-edit="closing-beat"]');
  const headline = query('[data-edit="headline"]');
  const subline = query('[data-edit="subline"]');
  const bars = root.querySelectorAll('.bars i');
  ['stage', 'ambient-a', 'ambient-b', 'grid', 'topline', 'eyebrow', 'counter', 'hero-beat', 'kicker', 'headline', 'subline',
    'proof-panel', 'panel-label', 'panel-time', 'proof-title', 'proof-copy', 'bars', 'closing-beat', 'mark', 'closing-label',
    'closing-headline', 'footer-line'].forEach((id) => register(id, query('[data-edit="' + id + '"]')));

  timeline.set([proof, closing], { autoAlpha: 0 }, 0);
  timeline.set(hero, { autoAlpha: 1, xPercent: -50, yPercent: -50 }, 0);
  timeline.fromTo([ambientA, ambientB], { scale: .72, rotation: -10 }, { scale: 1.08, rotation: 14, duration: ${duration}, ease: 'sine.inOut' }, 0);
  timeline.to(grid, { backgroundPosition: '54px 108px', duration: ${duration}, ease: 'none' }, 0);
  timeline.fromTo(headline, { autoAlpha: 0, y: 44, scale: 1.12 }, { autoAlpha: 1, y: 0, scale: 1, duration: .82, ease: 'power4.out' }, .15);
  timeline.fromTo(subline, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .56, ease: 'power3.out' }, .72);
  timeline.to(hero, { autoAlpha: 0, y: '-=34', duration: .54, ease: 'power3.in' }, ${Math.max(0.8, duration * .34)});
  timeline.fromTo(proof, { autoAlpha: 0, y: 70, scale: .94 }, { autoAlpha: 1, y: '-=70', scale: 1, duration: .78, ease: 'power4.out' }, ${Math.max(0.9, duration * .36)});
  timeline.fromTo(bars, { scaleY: .2, transformOrigin: 'center bottom' }, { scaleY: 1, duration: .6, stagger: .08, ease: 'back.out(1.4)' }, ${Math.max(1.2, duration * .48)});
  timeline.to(proof, { width: 'min(60%, 900px)', minHeight: 250, borderRadius: 120, duration: .72, ease: 'power3.inOut' }, ${Math.max(1.6, duration * .6)});
  timeline.to(proof, { autoAlpha: 0, y: '-=28', duration: .5, ease: 'power3.in' }, ${Math.max(1.8, duration * .68)});
  timeline.fromTo(closing, { autoAlpha: 0, scale: .84, xPercent: -50, yPercent: -50 }, { autoAlpha: 1, scale: 1, duration: .82, ease: 'back.out(1.25)' }, ${Math.max(2.2, duration * .72)});
  timeline.to(closing, { autoAlpha: 0, scale: 1.04, duration: .5, ease: 'power3.in' }, ${Math.max(2.8, duration * .92)});
}`,
    'index.ts': `import { defineComposition, type CompositionContext } from '@motify/runtime';
import compositionHtml from './composition.html?raw';
import './styles.css';
import { buildTimeline } from './timeline.js';

function mount(context: CompositionContext) {
  const documentNode = new DOMParser().parseFromString(compositionHtml, 'text/html');
  const template = documentNode.querySelector<HTMLTemplateElement>('#motify-template');
  if (!template) throw new Error('Motify template was not found.');
  context.root.replaceChildren(template.content.cloneNode(true));
}

export default defineComposition({
  id: 'generated-composition',
  title: ${title},
  description: 'Editorial Motify composition starter',
  width: ${settings.width},
  height: ${settings.height},
  fps: ${settings.fps},
  duration: ${duration},
  scenes: [
    { id: 'intro', label: 'Opening statement', start: 0, duration: ${Math.max(0.8, duration * .36)}, accent: '#e4614e', tracks: [{ id: 'hero-beat', label: 'Hero statement', kind: 'Text', start: 0, end: ${Math.max(0.8, duration * .36)} }] },
    { id: 'proof', label: 'Product proof', start: ${Math.max(0.8, duration * .36)}, duration: ${Math.max(0.8, duration * .36)}, accent: '#2cae78', tracks: [{ id: 'proof-panel', label: 'Proof panel', kind: 'Element', start: ${Math.max(0.8, duration * .36)}, end: ${Math.max(1.8, duration * .68)} }] },
    { id: 'closing', label: 'Closing promise', start: ${Math.max(1.8, duration * .68)}, duration: ${Math.max(0.8, duration * .32)}, accent: '#e4614e', tracks: [{ id: 'closing-beat', label: 'Closing statement', kind: 'Text', start: ${Math.max(2.2, duration * .72)}, end: ${duration} }] },
  ],
  sourcePreview: compositionHtml,
  build(context) { mount(context); buildTimeline(context); },
});`,
  };
}

export const QUALITY_STARTER_SOURCE_FILES = createQualityStarterSource({
  name: 'Generated composition', width: 1920, height: 1080, fps: 60, duration: 5,
});
