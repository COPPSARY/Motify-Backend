import gsap from 'gsap';

export interface MotionOptions {
  at?: gsap.Position;
  duration?: number;
  ease?: string;
}

export interface SlideOptions extends MotionOptions {
  direction?: 'up' | 'right' | 'down' | 'left';
  distance?: number;
}

export interface StaggerOptions extends SlideOptions {
  stagger?: number;
}

type Target = gsap.TweenTarget;

export function reveal(timeline: gsap.core.Timeline, target: Target, options: MotionOptions = {}) {
  return timeline.fromTo(target, { autoAlpha: 0, y: 18 }, {
    autoAlpha: 1, y: 0, duration: options.duration ?? 0.55, ease: options.ease ?? 'power3.out',
  }, options.at);
}

export function slide(timeline: gsap.core.Timeline, target: Target, options: SlideOptions = {}) {
  const distance = options.distance ?? 56;
  const direction = options.direction ?? 'up';
  return timeline.fromTo(target, {
    x: direction === 'left' ? distance : direction === 'right' ? -distance : 0,
    y: direction === 'down' ? -distance : direction === 'up' ? distance : 0,
    autoAlpha: 0,
  }, {
    x: 0, y: 0, autoAlpha: 1, duration: options.duration ?? 0.68, ease: options.ease ?? 'power4.out',
  }, options.at);
}

export function scalePop(timeline: gsap.core.Timeline, target: Target, options: MotionOptions = {}) {
  return timeline.fromTo(target, { scale: 0.82, autoAlpha: 0 }, {
    scale: 1, autoAlpha: 1, duration: options.duration ?? 0.62, ease: options.ease ?? 'back.out(1.35)',
  }, options.at);
}

export function blurReveal(timeline: gsap.core.Timeline, target: Target, options: MotionOptions = {}) {
  return timeline.fromTo(target, { filter: 'blur(18px)', autoAlpha: 0, y: 24 }, {
    filter: 'blur(0px)', autoAlpha: 1, y: 0, duration: options.duration ?? 0.72, ease: options.ease ?? 'power3.out',
  }, options.at);
}

export function maskWipe(timeline: gsap.core.Timeline, target: Target, options: SlideOptions = {}) {
  const hidden = {
    left: 'inset(0 0 0 100%)', up: 'inset(100% 0 0)', down: 'inset(0 0 100%)', right: 'inset(0 100% 0 0)',
  }[options.direction ?? 'right'];
  return timeline.fromTo(target, { clipPath: hidden }, {
    clipPath: 'inset(0 0 0 0)', duration: options.duration ?? 0.78, ease: options.ease ?? 'expo.out',
  }, options.at);
}

export function staggerEntrance(timeline: gsap.core.Timeline, targets: Target, options: StaggerOptions = {}) {
  return timeline.fromTo(targets, { y: options.distance ?? 52, autoAlpha: 0, scale: 0.96 }, {
    y: 0, autoAlpha: 1, scale: 1, duration: options.duration ?? 0.58,
    stagger: options.stagger ?? 0.09, ease: options.ease ?? 'power4.out',
  }, options.at);
}

export function staggerExit(timeline: gsap.core.Timeline, targets: Target, options: StaggerOptions = {}) {
  return timeline.to(targets, {
    y: -(options.distance ?? 34), autoAlpha: 0, duration: options.duration ?? 0.42,
    stagger: options.stagger ?? 0.055, ease: options.ease ?? 'power3.in',
  }, options.at);
}

export function cameraPush(
  timeline: gsap.core.Timeline,
  target: Target,
  options: MotionOptions & { scale?: number; x?: number; y?: number } = {},
) {
  return timeline.to(target, {
    scale: options.scale ?? 1.18, x: options.x ?? 0, y: options.y ?? 0,
    duration: options.duration ?? 1.35, ease: options.ease ?? 'power3.inOut',
  }, options.at);
}

export function cameraPull(
  timeline: gsap.core.Timeline,
  target: Target,
  options: MotionOptions & { scale?: number; x?: number; y?: number } = {},
) {
  return timeline.to(target, {
    scale: options.scale ?? 1, x: options.x ?? 0, y: options.y ?? 0,
    duration: options.duration ?? 1.25, ease: options.ease ?? 'power3.inOut',
  }, options.at);
}

export function sceneHandoff(
  timeline: gsap.core.Timeline,
  outgoing: Target,
  incoming: Target,
  options: SlideOptions = {},
) {
  const direction = options.direction ?? 'left';
  const duration = options.duration ?? 0.82;
  const axis = direction === 'left' || direction === 'right' ? 'xPercent' : 'yPercent';
  const incomingOffset = direction === 'left' || direction === 'up' ? 100 : -100;
  const handoff = gsap.timeline()
    .set(incoming, { autoAlpha: 1, zIndex: 2, [axis]: incomingOffset }, 0)
    .set(outgoing, { zIndex: 1 }, 0)
    .to(incoming, { [axis]: 0, duration, ease: options.ease ?? 'power3.inOut' }, 0)
    .to(outgoing, { [axis]: -incomingOffset * 0.18, scale: 1.035, duration, ease: options.ease ?? 'power3.inOut' }, 0)
    .set(outgoing, { autoAlpha: 0, xPercent: 0, yPercent: 0, scale: 1, zIndex: 0 })
    .set(incoming, { xPercent: 0, yPercent: 0, zIndex: 1 });
  return timeline.add(handoff, options.at);
}

export function morph(
  timeline: gsap.core.Timeline,
  target: Target,
  styles: gsap.TweenVars,
  options: MotionOptions = {},
) {
  return timeline.to(target, {
    ...styles, duration: options.duration ?? 0.8, ease: options.ease ?? 'power3.inOut',
  }, options.at);
}

export function splitText(element: HTMLElement, unit: 'words' | 'chars'): HTMLElement[] {
  if (element.dataset.motifySplitUnit === unit) return Array.from(element.querySelectorAll('.motify-split-item'));
  const children = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  if (children.length) {
    const pieces = children.flatMap((child) => splitText(child, unit));
    element.dataset.motifySplitUnit = unit;
    return pieces;
  }
  const pieces = unit === 'words' ? (element.textContent ?? '').split(/(\s+)/) : Array.from(element.textContent ?? '');
  element.dataset.motifySplitUnit = unit;
  element.replaceChildren();
  return pieces.map((piece) => {
    const span = document.createElement('span');
    span.textContent = piece;
    span.className = 'motify-split-item';
    span.style.display = piece.trim() ? 'inline-block' : 'inline';
    element.append(span);
    return span;
  });
}

export function textReveal(
  timeline: gsap.core.Timeline,
  element: HTMLElement,
  options: StaggerOptions & { unit?: 'words' | 'chars' } = {},
) {
  const pieces = splitText(element, options.unit ?? 'words');
  timeline.fromTo(pieces, { yPercent: 115, rotateX: -24, autoAlpha: 0 }, {
    yPercent: 0, rotateX: 0, autoAlpha: 1, duration: options.duration ?? 0.62,
    stagger: options.stagger ?? 0.045, ease: options.ease ?? 'power4.out',
  }, options.at);
  return pieces;
}

export function wordSlideRotate(
  timeline: gsap.core.Timeline,
  element: HTMLElement,
  options: StaggerOptions & { rotation?: number } = {},
) {
  const words = splitText(element, 'words');
  timeline.fromTo(words, {
    y: options.distance ?? 42,
    rotation: options.rotation ?? 4,
    autoAlpha: 0,
  }, {
    y: 0,
    rotation: 0,
    autoAlpha: 1,
    duration: options.duration ?? 0.58,
    stagger: options.stagger ?? 0.045,
    ease: options.ease ?? 'power3.out',
  }, options.at);
  return words;
}

export function charSpringBounce(
  timeline: gsap.core.Timeline,
  element: HTMLElement,
  options: StaggerOptions = {},
) {
  const chars = splitText(element, 'chars');
  timeline.fromTo(chars, {
    y: options.distance ?? 30,
    scale: 0.82,
    autoAlpha: 0,
  }, {
    y: 0,
    scale: 1,
    autoAlpha: 1,
    duration: options.duration ?? 0.48,
    stagger: options.stagger ?? 0.025,
    ease: options.ease ?? 'back.out(1.7)',
  }, options.at);
  return chars;
}

export function continuousTextGradient(
  element: HTMLElement,
  gradient = 'linear-gradient(96deg, #111318 0%, #7657ff 42%, #c753ff 62%, #111318 100%)',
) {
  const words = splitText(element, 'words').filter((word) => Boolean(word.textContent?.trim()));
  const elementRect = element.getBoundingClientRect();
  const gradientWidth = Math.max(1, element.scrollWidth);
  const layoutRatio = gradientWidth / Math.max(1, elementRect.width);
  words.forEach((word) => {
    const offset = (elementRect.left - word.getBoundingClientRect().left) * layoutRatio;
    word.style.backgroundImage = gradient;
    word.style.backgroundRepeat = 'no-repeat';
    word.style.backgroundSize = `${gradientWidth}px 100%`;
    word.style.backgroundPosition = `${offset}px 0`;
    word.style.backgroundClip = 'text';
    word.style.webkitBackgroundClip = 'text';
    word.style.webkitTextFillColor = 'transparent';
  });
  return words;
}

export function gradientSweep(
  timeline: gsap.core.Timeline,
  target: Target,
  options: MotionOptions & { fromPosition?: string; toPosition?: string } = {},
) {
  return timeline.fromTo(target, {
    backgroundPosition: options.fromPosition ?? '200% 0',
  }, {
    backgroundPosition: options.toPosition ?? '0% 0',
    duration: options.duration ?? 1.4,
    ease: options.ease ?? 'power2.inOut',
  }, options.at);
}

export function ambientWaves(
  timeline: gsap.core.Timeline,
  waves: Target[],
  options: MotionOptions & { totalDuration?: number; yOffset?: number; scaleXOffset?: number } = {},
) {
  const totalDuration = options.totalDuration ?? 24;
  waves.forEach((wave, index) => timeline.fromTo(wave, {
    y: (options.yOffset ?? -20) + index * 14,
    x: index % 2 === 0 ? -40 : 40,
    scaleX: options.scaleXOffset ?? 1.2,
    scaleY: 1.05,
    opacity: 0.32,
  }, {
    y: (options.yOffset ?? -20) - index * 14,
    x: index % 2 === 0 ? 40 : -40,
    scaleX: (options.scaleXOffset ?? 1.2) * 1.08,
    scaleY: 1.12,
    opacity: 0.46,
    duration: totalDuration,
    ease: 'sine.inOut',
  }, options.at));
  return timeline;
}
