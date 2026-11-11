/**
 * Three.js engine: renderer (+ restrained bloom), scene, camera, lights with
 * shadows, world dressing, resize, animation loop, picking/hover — and a
 * VIEW INSET so the scene is centered in the part of the screen NOT covered
 * by the HUD (sidebar on desktop, bottom sheet / drawer on tablets & phones).
 *
 * Anti-aliasing pipeline
 *   - `antialias: true` is a WebGL context attribute: it can ONLY be passed to
 *     the WebGLRenderer constructor (setting renderer.antialias later is a no-op).
 *   - With post-processing, the scene is rendered into an offscreen target, which
 *     would lose that MSAA → jagged edges. The composer therefore gets its own
 *     multisampled target (samples: 4), so bloom keeps edges smooth.
 *   - Pixel ratio is capped at 2 and re-synced on every resize (monitor changes).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MAX_PIXEL_RATIO = 2;
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

/** Vertical sky gradient (screen-space background, matches the CSS body gradient). */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#7cb8ff');
  g.addColorStop(0.55, '#bfe0ff');
  g.addColorStop(1, '#eaf6ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.updaters = new Set();
    this.pickables = new Set();
    this.hoverables = new Set();
    this.hovered = null;
    this.pointerNdc = null;
    this.raycaster = new THREE.Raycaster();
    this.inset = { left: 0, bottom: 0 };        // applied (animated)
    this.insetTarget = { left: 0, bottom: 0 };  // requested by the HUD layout
    this.cameraGoal = null;
    this.started = false;
    // Phones / low-core devices skip post-processing (MSAA of the default framebuffer still applies).
    this.highQuality = (navigator.hardwareConcurrency || 4) >= 4 && !matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setClearColor('#bfe0ff', 1); // same as the sky: no flash before the first frame
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps block colors saturated
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog('#d6ecff', 45, 95);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 14, 22);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 110; // portrait phones need distance to fit the boards' width
    this.controls.target.set(0, 1, 0);
    this.controls.addEventListener('start', () => { this.cameraGoal = null; });

    if (this.highQuality) {
      // Multisampled HDR target → bloom without losing anti-aliasing.
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Threshold 1.0: only HDR star particles and charged (white-hot) blocks bloom.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.#lights();
    this.#world();
    this.#events();
    this.resize();
  }

  #lights() {
    this.scene.add(new THREE.HemisphereLight('#eaf4ff', '#7fb85e', 0.85));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(10, 24, 14);
    sun.castShadow = true;
    const map = this.highQuality ? 2048 : 1024;
    sun.shadow.mapSize.set(map, map);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#b9c7ff', 0.6);
    rim.position.set(-14, 10, -12);
    this.scene.add(rim);
  }

  #world() {
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(32, 34, 2, 72),
      new THREE.MeshStandardMaterial({ color: '#94d36f', roughness: 0.95 }),
    );
    island.position.y = -1;
    island.receiveShadow = true;
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.2, 20),
      new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.85 }),
    );
    mat.position.set(0, 0.1, 1.5);
    mat.receiveShadow = true;
    this.scene.add(island, mat);

    // Ambient: a few slow low-poly clouds (cheap, restful motion).
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 5; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        m.position.set(j * 1.3 - 2, Math.random() * 0.6, Math.random() * 0.8);
        m.scale.setScalar(1 + Math.random() * 0.8);
        cloud.add(m);
      }
      cloud.position.set(-40 + i * 20, 12 + Math.random() * 6, -30 - Math.random() * 10);
      const speed = 0.3 + Math.random() * 0.4;
      this.onUpdate((dt) => { cloud.position.x += speed * dt; if (cloud.position.x > 50) cloud.position.x = -50; });
      this.scene.add(cloud);
    }
  }

  #events() {
    // Resize: window, rotation, and the mobile visual viewport (URL bar / keyboard),
    // coalesced to one update per frame.
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; this.resize(); });
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);

    this.canvas.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return; // touch has no hover; taps still pick
      this.pointerNdc = this.#ndc(e);
    });
    this.canvas.addEventListener('pointerleave', () => { this.pointerNdc = new THREE.Vector2(9, 9); });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.downAt || Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 6) return;
      this.raycaster.setFromCamera(this.#ndc(e), this.camera);
      const hit = this.raycaster.intersectObjects([...this.pickables], true)[0];
      let o = hit?.object;
      while (o && !o.userData.onPick) o = o.parent;
      o?.userData.onPick(o);
    });
  }

  #ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /**
   * Camera shake: a decaying sine offset added ONLY for the rendered frame
   * (removed right after), so OrbitControls' state is never corrupted.
   */
  shake({ duration = 0.3, amplitude = 0.22, speed = 55 } = {}) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.shakeState = { start: performance.now(), duration: duration * 1000, amplitude, speed };
  }

  #shakeOffset(now) {
    const s = this.shakeState;
    if (!s) return null;
    const e = now - s.start;
    if (e >= s.duration) { this.shakeState = null; return null; }
    const decay = (1 - e / s.duration) ** 2;
    const a = s.amplitude * decay;
    const w = (now / 1000) * s.speed;
    return {
      pos: new THREE.Vector3(Math.sin(w) * a, Math.sin(w * 1.37 + 1.1) * a * 0.6, Math.sin(w * 0.73 + 2.3) * a * 0.3),
      roll: Math.sin(w * 1.9) * a * 0.04,
    };
  }

  /** Register an object whose userData.onHover(on) fires on pointer enter/leave. */
  addHoverable(obj, onHover) { obj.userData.onHover = onHover; this.hoverables.add(obj); }

  #updateHover() {
    if (!this.pointerNdc) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.pointerNdc = null;
    let o = this.raycaster.intersectObjects([...this.hoverables], true)[0]?.object;
    while (o && !o.userData.onHover) o = o.parent;
    if (o === this.hovered) return;
    this.hovered?.userData.onHover(false);
    this.hovered = o || null;
    this.hovered?.userData.onHover(true);
    this.canvas.style.cursor = this.hovered ? 'pointer' : '';
  }

  addPickable(obj, onPick) { obj.userData.onPick = onPick; this.pickables.add(obj); }
  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  /**
   * Reserve screen space covered by the HUD (CSS px). The applied inset eases
   * toward it every frame, so the scene glides when a drawer slides.
   */
  setInset({ left = 0, bottom = 0 }) {
    this.insetTarget = { left, bottom };
    if (!this.started) { this.inset = { left, bottom }; this.#applyView(); }
    if (this.lastFrameBox) this.frame(this.lastFrameBox);
  }

  /** Projection with a view offset: the scene's center lands in the free area. */
  #applyView() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, -this.inset.left / 2, this.inset.bottom / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Window resize: aspect, renderer size, pixel ratio (monitor changes), composer. */
  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = pixelRatio();
    if (pr !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pr);
      this.composer?.setPixelRatio(pr);
    }
    this.renderer.setSize(w, h, false); // CSS keeps the canvas full-bleed
    this.composer?.setSize(w, h);
    this.#applyView();
    if (this.lastFrameBox) this.frame(this.lastFrameBox);
  }

  /** Smoothly fit a Box3 inside the free (non-HUD) area. */
  frame(box) {
    this.lastFrameBox = box.clone();
    const { left, bottom } = this.insetTarget;
    const w = Math.max(innerWidth - left, 160), h = Math.max(innerHeight - bottom, 160);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov) * (h / innerHeight);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (w / h));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 1.05, 1).normalize();
    // Width governs horizontally; depth+height (seen at ~46°) vertically.
    const distW = (size.x / 2) / Math.tan(hfov / 2);
    const distH = ((size.z * 0.72 + size.y * 0.7) / 2) / Math.tan(vfov / 2);
    const dist = Math.min(Math.max(distW, distH, 10) * 1.12 + size.y * 0.5, this.controls.maxDistance);
    this.cameraGoal = { target: center, position: center.clone().addScaledVector(dir, dist) };
  }

  start() {
    this.started = true;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;

      // Ease the HUD inset (drawer slides) → the view re-centers smoothly.
      const ic = this.inset, it = this.insetTarget;
      if (ic.left !== it.left || ic.bottom !== it.bottom) {
        const k = 1 - Math.pow(0.0005, dt);
        ic.left += (it.left - ic.left) * k;
        ic.bottom += (it.bottom - ic.bottom) * k;
        if (Math.abs(ic.left - it.left) < 0.5) ic.left = it.left;
        if (Math.abs(ic.bottom - it.bottom) < 0.5) ic.bottom = it.bottom;
        this.#applyView();
      }
      if (this.cameraGoal) {
        const k = 1 - Math.pow(0.004, dt);
        this.camera.position.lerp(this.cameraGoal.position, k);
        this.controls.target.lerp(this.cameraGoal.target, k);
        if (this.camera.position.distanceTo(this.cameraGoal.position) < 0.02) this.cameraGoal = null;
      }
      this.#updateHover();
      this.updaters.forEach((fn) => fn(dt, t));
      this.controls.update();
      // Fog follows the camera distance, so far-framed phones don't wash out.
      const d = this.camera.position.distanceTo(this.controls.target);
      this.scene.fog.near = d + 18;
      this.scene.fog.far = d + 75;
      const shake = this.#shakeOffset(performance.now());
      if (shake) { this.camera.position.add(shake.pos); this.camera.rotateZ(shake.roll); }
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
      if (shake) { this.camera.rotateZ(-shake.roll); this.camera.position.sub(shake.pos); }
    };
    loop();
  }
}
