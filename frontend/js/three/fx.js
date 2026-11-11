/**
 * Visual effects: pooled star-particle bursts and canvas text labels.
 */
import * as THREE from 'three';

function starTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  // 5-point star core
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.16 : s * 0.42, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round glow sprite for vortex particles. */
export function softDotTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Star particle system. One Points object with a fixed pool; bursts recycle
 * the oldest particles. Additive blending → fades to transparent with color.
 */
export class StarBurst {
  constructor(scene, size = 700) {
    this.n = size;
    this.cursor = 0;
    this.pos = new Float32Array(size * 3);
    this.col = new Float32Array(size * 3);
    this.base = new Float32Array(size * 3);
    this.vel = new Float32Array(size * 3);
    this.life = new Float32Array(size);
    this.maxLife = new Float32Array(size).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.55, map: starTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  /**
   * @param {THREE.Vector3} origin
   * @param {{count?:number, colors?:string[], speed?:number, up?:number, gravity?:number, life?:number}} o
   */
  burst(origin, { count = 60, colors = ['#fff3a3', '#ffd23f', '#ffffff'], speed = 5, up = 4, life = 1.2 } = {}) {
    const palette = colors.map((c) => new THREE.Color(c));
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      origin.toArray(this.pos, i * 3);
      const theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * v + up * Math.random();
      this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v;
      palette[k % palette.length].toArray(this.base, i * 3);
      this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
    }
  }

  update(dt) {
    let alive = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 9 * dt;
      const drag = 1 - 1.6 * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      for (let c = 0; c < 3; c++) this.col[i * 3 + c] = this.base[i * 3 + c] * k * 2.2; // HDR → bloom
    }
    if (alive || this.wasAlive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    this.wasAlive = alive;
  }
}

/** Rounded "pill" text sprite. `sprite.userData.setText(text, colors)` updates it. */
export function createLabel(text, { bg = 'rgba(255,255,255,0.92)', fg = '#1e293b', scale = 1, width = 512 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((width / 128) * scale, scale, 1);
  sprite.userData.setText = (t, colors = {}) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, 128);
    ctx.fillStyle = colors.bg || bg;
    ctx.beginPath(); ctx.roundRect(6, 10, width - 12, 108, 54); ctx.fill();
    ctx.fillStyle = colors.fg || fg;
    ctx.font = '800 58px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, width / 2, 68, width - 40);
    tex.needsUpdate = true;
  };
  sprite.userData.setText(text);
  sprite.userData.dispose = () => { tex.dispose(); sprite.material.dispose(); };
  return sprite;
}
