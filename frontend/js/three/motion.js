/**
 * GSAP-powered motion primitives for 3D objects. Every helper returns a
 * gsap tween/timeline so callers can sequence them or `await` them.
 */
import * as THREE from 'three';
import { gsap } from 'gsap';

if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  gsap.globalTimeline.timeScale(2.5); // keep the meaning, shorten the motion
}

export { gsap };

/**
 * Fly an object along a quadratic Bézier arc (lerp between lerps) to a world
 * position. The object must be a direct child of the scene (world space).
 */
export function flyTo(obj, target, { height = 2, duration = 0.8, delay = 0, ease = 'power2.inOut', spin = 0, onComplete } = {}) {
  const p0 = obj.position.clone();
  const p2 = target.clone();
  const p1 = p0.clone().lerp(p2, 0.5);
  p1.y = Math.max(p0.y, p2.y) + height;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const rot0 = obj.rotation.y;
  const state = { t: 0 };
  return gsap.to(state, {
    t: 1, duration, delay, ease,
    onUpdate() {
      a.lerpVectors(p0, p1, state.t);
      b.lerpVectors(p1, p2, state.t);
      obj.position.lerpVectors(a, b, state.t);
      if (spin) obj.rotation.y = rot0 + spin * Math.sin(state.t * Math.PI);
    },
    onComplete,
  });
}

/** Elastic "pop" in from (near) zero. */
export const popIn = (obj, { delay = 0, duration = 0.5 } = {}) => {
  obj.scale.setScalar(0.001);
  return gsap.to(obj.scale, { x: 1, y: 1, z: 1, duration, delay, ease: 'back.out(2.2)' });
};

/** Shrink to nothing. */
export const popOut = (obj, { delay = 0, duration = 0.3 } = {}) =>
  gsap.to(obj.scale, { x: 0.001, y: 0.001, z: 0.001, duration, delay, ease: 'back.in(2)' });

/** Brief emissive flash on a material (must be the block's own material). */
export const flash = (material, { intensity = 0.9, duration = 0.35 } = {}) =>
  gsap.timeline()
    .to(material, { emissiveIntensity: intensity, duration: duration * 0.4, ease: 'power2.out' })
    .to(material, { emissiveIntensity: 0, duration: duration * 0.6, ease: 'power2.in' });

/** Promise that resolves when a tween/timeline finishes. */
export const done = (tween) => new Promise((resolve) => {
  if (tween.progress() === 1) return resolve();
  const prev = tween.eventCallback('onComplete');
  tween.eventCallback('onComplete', (...args) => { prev?.(...args); resolve(); });
});
export const wait = (s) => new Promise((r) => gsap.delayedCall(s, r));
