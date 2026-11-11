/**
 * Game titles for the portals — cartoon "block letters" rendered INSIDE the
 * WebGL scene (canvas-texture sprites, so they live in 3D, billboard to the
 * camera and are hit by the raycaster).
 *
 * Look (drawn per frame of state, not per animation frame):
 *   1. outer glow   = the portal's vortex color, exactly (visual harmony)
 *   2. faux-3D extrusion: stacked copies in a dark shade of that color
 *   3. thick ink outline (cartoon border)
 *   4. vertical gradient fill (white-hot top → theme color → deeper bottom)
 *   5. glossy highlight stroke
 * Font: "Luckiest Guy" (Google Fonts), redrawn once it has loaded.
 *
 * Motion (GSAP + per-frame):
 *   idle   → sinusoidal bob + tiny sway
 *   hover  → squash & stretch spring + cheerful jump, stays slightly bigger
 *   click  → jump again
 */
import * as THREE from 'three';
import { gsap } from './motion.js';

const FONT = '"Luckiest Guy", "Nunito", system-ui, sans-serif';
const INK = '#1b1240';
const W = 1024, H = 420;

const fontReady = document.fonts?.load(`120px ${FONT}`).catch(() => null) ?? Promise.resolve();

/** Mix a hex color toward black/white. */
function shade(hex, amount) {
  const c = new THREE.Color(hex);
  return `#${(amount < 0 ? c.lerp(new THREE.Color('#000000'), -amount) : c.lerp(new THREE.Color('#ffffff'), amount)).getHexString()}`;
}

/** Largest font size (≤ max) so `text` fits `width`. */
function fit(ctx, text, max, width) {
  let size = max;
  do { ctx.font = `${size}px ${FONT}`; size -= 4; } while (ctx.measureText(text).width > width && size > 30);
  return size + 4;
}

function drawWord(ctx, text, cx, baseline, size, { color, glow, depth = 10, ink = INK }) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // 1. Colored glow (exact vortex color)
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 38;
  ctx.strokeStyle = glow;
  ctx.lineWidth = size * 0.3;
  ctx.strokeText(text, cx, baseline + depth);
  ctx.restore();

  // 2. Extrusion (faux 3D) + 3. ink outline around it
  const side = shade(color, -0.45);
  for (let i = depth; i > 0; i -= 2) {
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = ink;
    ctx.strokeText(text, cx, baseline + i);
    ctx.fillStyle = side;
    ctx.fillText(text, cx, baseline + i);
  }
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = ink;
  ctx.strokeText(text, cx, baseline);

  // 4. Gradient face
  const g = ctx.createLinearGradient(0, baseline - size * 0.85, 0, baseline);
  g.addColorStop(0, shade(color, 0.75));
  g.addColorStop(0.45, shade(color, 0.2));
  g.addColorStop(1, shade(color, -0.12));
  ctx.fillStyle = g;
  ctx.fillText(text, cx, baseline);

  // 5. Gloss
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, cx, baseline - size * 0.04);
  ctx.restore();
}

/**
 * @param {{ lines: [string, string], color: string, width?: number }} o
 *   lines: [small top word, big main word]; color: the portal's vortex color.
 */
export function createGameTitle({ lines, color, width = 7.2 }) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  const base = { x: width, y: width * (H / W) };
  sprite.scale.set(base.x, base.y, 1);

  const state = { locked: false, selected: false, unlockLevel: 1 };
  const anim = { sx: 1, sy: 1, lift: 0, size: 1, sway: 0 };
  const phase = Math.random() * Math.PI * 2;
  let baseY = 0;

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const col = state.locked ? '#9aa3b5' : color;
    const glow = state.locked ? '#64748b' : color;
    const ink = state.locked ? '#334155' : INK;
    const top = fit(ctx, lines[0], 108, W * 0.7);
    const main = fit(ctx, lines[1], 168, W * 0.92);
    drawWord(ctx, lines[0], W / 2, 140, top, { color: col, glow, depth: 8, ink });
    drawWord(ctx, lines[1], W / 2, 140 + main * 0.95, main, { color: col, glow, depth: 12, ink });

    if (state.locked) {
      // Lock chip under the title
      ctx.font = `64px ${FONT}`;
      const label = `🔒 NIVEL ${state.unlockLevel}`;
      const w = ctx.measureText(label).width + 60;
      ctx.fillStyle = 'rgba(30,41,59,0.92)';
      ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, H - 92, w, 84, 42); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, W / 2, H - 48);
    } else if (state.selected) {
      // Sparkle stars on both sides
      ctx.font = `90px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.fillStyle = '#ffe14d';
      for (const x of [70, W - 70]) { ctx.strokeText('★', x, 120); ctx.fillText('★', x, 120); }
    }
    tex.needsUpdate = true;
  }
  draw();
  fontReady.then(draw);

  sprite.userData.title = {
    /** Base height above the portal origin (the bob oscillates around it). */
    setBaseY(y) { baseY = y; sprite.position.y = y; },
    setState({ locked, selected, unlockLevel }) {
      if (locked === state.locked && selected === state.selected && unlockLevel === state.unlockLevel) return;
      Object.assign(state, { locked, selected, unlockLevel });
      draw();
      gsap.to(anim, { size: selected ? 1.12 : 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' });
    },
    /** Juicy hover: squash → stretch → spring, plus a little jump. */
    hover(on) {
      gsap.killTweensOf(anim, 'sx,sy');
      if (on) {
        gsap.timeline()
          .to(anim, { sx: 1.28, sy: 0.74, duration: 0.08, ease: 'power2.out' })
          .to(anim, { sx: 0.86, sy: 1.24, duration: 0.1, ease: 'power2.inOut' })
          .to(anim, { sx: 1.12, sy: 1.12, duration: 0.7, ease: 'elastic.out(1.1, 0.32)' });
        this.jump();
      } else {
        gsap.to(anim, { sx: 1, sy: 1, duration: 0.45, ease: 'elastic.out(1, 0.5)' });
      }
    },
    jump() {
      gsap.killTweensOf(anim, 'lift');
      gsap.timeline()
        .to(anim, { lift: 0.75, duration: 0.18, ease: 'power2.out' })
        .to(anim, { lift: 0, duration: 0.6, ease: 'bounce.out' });
    },
    /** Per-frame: sinusoidal bob (≈ Math.sin(Date.now() * 0.002)) + sway. */
    update(t) {
      const bob = Math.sin(t * 2 + phase) * 0.14;
      sprite.position.y = baseY + bob + anim.lift;
      material.rotation = Math.sin(t * 1.3 + phase) * 0.035;
      const k = anim.size;
      sprite.scale.set(base.x * anim.sx * k, base.y * anim.sy * k, 1);
    },
  };
  return sprite;
}
