# Mundo Matemático 3D

A 3D math game for 3rd and 4th graders. The backend and the frontend are two separate programs.

```
math-game-3d/
├── render.yaml              ← Render Blueprint: deploys both services
├── backend/                 ← Process 1: stateless math engine (port 5000)
│   ├── server.js            single file, zero dependencies, NO database, CORS allowlist
│   ├── server.test.js       node:test unit + HTTP/CORS tests
│   ├── .env.example         every environment variable, documented
│   └── package.json         "start": "node server.js"
└── frontend/                ← Process 2: static 3D client (port 5173)
    ├── index.html           glass HUD + importmap (Three.js 0.170, GSAP 3.12)
    ├── css/app.css          Tailwind source (compiled → css/tailwind.css)
    ├── tailwind.config.js
    ├── scripts/             dev.mjs (watch + serve) · build.mjs (→ dist/) · tailwind.mjs
    ├── serve.mjs            zero-dependency static server (dev & `npm run preview`)
    └── js/
        ├── config.js        environment-aware API routing (local vs production)
        ├── env.js           build-time values (API_BASE_URL), generated into dist/
        ├── api.js           the only fetch() module: timeouts + wakes a sleeping server
        ├── storage.js       LocalStorage sync
        ├── game.js          explicit state machine: boot → loading → playing ⇄ animating → checking → solved
        ├── core/engine.js   renderer (MSAA kept through bloom), lights/shadows, resize, view inset
        ├── three/blocks.js  base-ten block factory (InstancedMesh) + partOffsets() for merge/fracture
        ├── three/board.js   PlaceBoard: real block piles, take()/receive() flights, live zone counters
        ├── three/motion.js  GSAP primitives: Bézier arc flyTo, pops, flashes (prefers-reduced-motion aware)
        ├── three/fx.js      pooled star-particle bursts, text sprites
        ├── three/titles.js  cartoon portal titles (canvas → sprite) with bob, hover squash/stretch, jump
        ├── three/portals.js archways built from base-ten blocks + spiralling particle vortex
        ├── ui/hud.js        HUD rendering: stats, tabs, inline feedback card, toasts
        ├── ui/layout.js     responsive HUD: sidebar / drawer / bottom sheet + 3D view inset
        └── modes/           one class per activity, owning BOTH its 3D stage and its HUD inputs
            ├── valueMode.js        steppers → blocks drop in
            ├── columnMode.js       shared stage + reconcile() (moves real blocks between rows and tray; red for any excess) + merge/break animations
            ├── additionMode.js     LLEVO box ⇄ merge 10 → 1 and fly to the Llevo pad (with undo)
            └── subtractionMode.js  PRESTO box / button ⇄ break 1 → 10 and move them to the right (with undo)
```

### How inputs drive the 3D scene
Blocks are **finite**: the answer never creates new ones. They only move when the child does something.

**Answer boxes (`reconcile`).**
- Typing digit **d** in a column moves exactly **d real blocks** of that column down from the operation into **Tu respuesta**. Each block takes its own curved flight.
- Lowering or clearing the digit sends the extra blocks back to where they came from.
- If **d** is more than the column actually has, the missing blocks appear on the tray in **red** (`MeshStandardMaterial({ color: 0xff0000, roughness: 0.2 })`, one shared material). The label shows ⚠.
- How to spot mistakes:
  - Addition: a right answer leaves the operation completely empty, so any block left up top means something is wrong.
  - Subtraction: a right answer leaves the top row with exactly as many blocks as the red row underneath.
- Every block knows its home (row A, row B or a Llevo pad) and its slot. `reconcile(p)` makes the tray match the typed digit. It can safely run any number of times and runs after every typed digit and every carry or borrow.

**LLEVO (addition).**
- Clicking the box shows **1** straight away. 10 blocks of the column to its right come together: first from the rows, then from the tray if the child already moved too many down.
- They merge into one block of the next column, which flies up to its Llevo pad.
- If the blocks came from the tray, the tray turns red for those missing blocks, so the child sees the digit is now wrong.
- If that column has fewer than 10 blocks in total, the carry is refused.
- Clicking again undoes it: each piece goes back to where it came from. Any carry built on top of it is undone first.

**PRESTO (subtraction).**
- Clicking the box shows **1** straight away. One block of that column (taken back out of the tray if needed) breaks into 10, and they fly across into the column on its right. Red blocks there become real.
- The panel works like a notebook: when a digit's value changes, the original shrinks into the top-right corner of its box and turns grey, and the new value pops in large and bold in the centre (2 → 1, 0 → 10 → 9, 6 → 16).
- An empty column can't lend, so to borrow across a zero the next column to the left must lend first.
- Clicking again merges 10 blocks back into one. If the column on the right had already lent onward, that loan is undone first.
- The "Pedir prestado" buttons work the same as clicking PRESTO.
- The **BLOQUES** row has been removed from the panel.

**Error feedback.** Whenever a typed digit creates new red blocks:
- The camera shakes for 0.3 s, fading out (`Engine.shake`). The shake is added only to the frame being drawn, so the camera controls are never thrown off.
- The left panel does a short shiver.
- Phones vibrate (`navigator.vibrate`).
- With `prefers-reduced-motion`, the shake is replaced by a red outline.

**Portals.** The three level portals are archways made of base-ten blocks:
- Place value: upright green hundreds.
- Addition: blue tens shafts with yellow chevrons.
- Subtraction: yellow unit towers under a blue shaft that has broken into 10 floating cubes.

Inside each one, a cloud of particles spirals inward.

Above each portal floats a cartoon game title (`three/titles.js`, font *Luckiest Guy*), drawn into the 3D scene:
- **Look:** thick dark outline, a fake 3D edge, a gradient fill and a shine. The glow and edge use exactly the same colour as that portal's swirl (green / blue / golden orange, all from `MODULE_INFO.color`).
- **Motion:** the titles bob up and down gently all the time.
- **Hover:** pointing near a portal or its title makes the title squash, stretch and spring back with a little jump. It stays a bit bigger, the swirl speeds up and the cursor turns into a pointer. An invisible, generous hit area makes "near" count.
- **Click:** the title jumps.
- **State:** the selected portal gets ★ stars; locked ones turn grey with a 🔒 NIVEL N tag. The portals use plain 12-triangle cubes and don't cast shadows, to keep them cheap.

**Box limits.** Answer boxes take a single digit from 0 to 9. LLEVO and PRESTO only take **1**; typing 2–9 shows a message explaining that blocks are always grouped in tens.

**Materials.**
- Blocks are fully opaque, matte and slightly self-lit: emerald `#12b04a`, royal blue `#1f6fff`, sunflower `#ffc21a`.
- Neutral tone mapping keeps the colours saturated (the previous ACES setting washed them out).
- Bloom only affects the bright star particles, never the blocks.

## Run locally

Requires Node ≥ 20. Two terminals:

```bash
cd backend && npm start
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. The frontend finds the API at `http://localhost:5000` on its own.

Useful extras:
- `npm test` in `backend/` runs the 9 tests: maths, tokens and CORS.
- `npm run preview` in `frontend/` builds the production version and serves `dist/`.
- **Testing on a phone:** open `http://<your-PC-IP>:5173` on a phone on the same Wi-Fi. The app then calls `http://<your-PC-IP>:5000`, and the backend already accepts addresses on your home network.
- **Pointing at another backend:** while running locally, add `?api=https://…` to the address. This is ignored in production on purpose.

## Screens and layouts
The layout is decided in CSS (`css/app.css` → `--hud-layout`), and `ui/layout.js` only opens and closes the panel:

| Screen | Panel | Opening and closing |
|---|---|---|
| ≥ 1024 px wide and ≥ 560 px tall (desktop, tablet in landscape) | left sidebar, 30% wide | always open |
| landscape and < 560 px tall (phone on its side) | left drawer | pull tab ‹ › |
| everything else (phones and tablets upright) | bottom sheet | tap or swipe the handle; when closed, a strip with the level, stars and coins stays visible |

- Whenever the panel opens, closes or changes size, the 3D view slides to stay centred in the part of the screen that's free.
- Feedback cards and messages reopen a closed panel.
- The layout respects phone notches and rounded corners (`viewport-fit=cover`, `env(safe-area-inset-*)`).

## Rendering
- **Antialiasing:** `antialias: true` only works when passed to the `WebGLRenderer` constructor. Setting `renderer.antialias = true` afterwards does nothing.
  - On desktop, the bloom glow renders the scene into intermediate images first, which would normally lose antialiasing. Those images use 4 samples (`samples: 4`), so edges stay smooth.
  - On phones there is no bloom and the browser's own antialiasing is used.
- **Resolution:** `setPixelRatio(min(devicePixelRatio, 2))`, re-checked on every resize. That handles moving the window to another monitor.
- **Shadows:** `PCFSoftShadowMap`; the shadow map is 1024 px on phones and 2048 px on desktop.
- **Resizing:** listens to the window, rotation and the phone's visible area (address bar, keyboard), at most once per frame. Each resize updates the camera's aspect ratio, the renderer size and the effects.
- **No flicker:** the coloured pads under the blocks sat exactly on the table surface, which made edges flicker. They're now raised 5 mm.
- **Background:** the sky is drawn inside the 3D scene and the page behind it uses the same colours, so nothing flashes while it loads.

## Deploy to Render

The project deploys as two Render services from a single `render.yaml`: an API (Node web service) and the game (static site).

1. Push `math-game-3d/` to a GitHub or GitLab repository, with `render.yaml` at the top level.
2. In Render, choose **New → Blueprint**, pick the repository and click **Apply**. That creates:

| Service | Type | Folder | Build | Start / publish |
|---|---|---|---|---|
| `math3d-api` | Web Service (Node, free) | `backend/` | `npm install --omit=dev` | `npm start` · health check `/api/health` |
| `math3d-web` | Static Site | `frontend/` | `npm ci --include=dev && npm run build` | `dist/` |

3. Check the two web addresses. Render addresses are shared by everyone, so if `math3d-api` or `math3d-web` was already taken Render adds a suffix. If that happens, update them in the dashboard:
   - `math3d-web` → `API_BASE_URL` = the API's address, then **Manual Deploy**. It's a build setting, so it only takes effect after a new build.
   - `math3d-api` → `ALLOWED_ORIGINS` = the game's address.

### Environment variables
| Service | Variable | Purpose |
|---|---|---|
| api | `PORT` | Set by Render. Locally it defaults to 5000. |
| api | `GAME_SECRET` | Secret for signing tokens (Render generates it). Keeps challenges valid when the server restarts. |
| api | `ALLOWED_ORIGINS` | Game addresses allowed to call the API, comma-separated. |
| api | `ALLOW_LOCAL_ORIGINS` | `false` blocks localhost and local-network addresses in production. |
| web | `API_BASE_URL` | API address, written into `dist/js/env.js` during the build. Must use `https://`. |

### How it behaves in production
- **Where the API is:** `config.js` checks the page's own address. Locally (localhost, `127.0.0.1`, `*.localhost`, local-network IPs) it calls `http://<same host>:5000`. Otherwise it uses `API_BASE_URL`, falling back to `https://math3d-api.onrender.com`.
- **CORS:** the API allows each permitted origin by name instead of `*`, sends `Access-Control-Allow-Credentials: true` and `Vary: Origin`, and rejects pre-flight checks from other origins with **403**.
- **Free tier sleep:** a free API instance goes to sleep after about 15 minutes without visits, and waking it takes up to a minute. The game:
  - waits patiently (70 s per try, 3 tries);
  - shows "Despertando el servidor de retos… ☕" with an amber pulsing dot;
  - if a challenge has expired, quietly loads a new one.
- **Deploys:** the API shuts down cleanly on `SIGTERM`, which Render sends on every deploy, and keeps connections open long enough for Render's proxy (`keepAliveTimeout`).
- **Caching:** the static site sends `Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` and `Permissions-Policy`. The page loads the CSS and JS with `?v=<commit>`, so browsers fetch the new version after each deploy.

### Checked before release
- The 9 backend tests pass, including a real HTTP server: health check, credentialed pre-flight, and a blocked origin.
- A production simulation on this machine: the `dist/` build served under a fake non-local domain, against an API in `NODE_ENV=production` that only accepted that domain.
  - From the allowed domain, the challenge loaded and a credentialed POST returned 200.
  - From a second domain, the browser blocked the request and the game showed a friendly message.
- Screens tested at 1366×768 (sidebar), 820×1180 (sheet), 390×844 (sheet) and 844×390 (drawer), opening and closing the panel each time, with no console errors.

## API

### `GET /api/challenges?grade=3|4&module=value|addition|subtraction`
Returns a random challenge:
- **value**: the number to build (grade 3: 100–999, grade 4: 1000–9999). About 30% of numbers have a zero in the middle, like 305. The prompt can show the number as digits, in words, or in expanded form.
- **addition**: always needs carrying (grade 4: at least 2 carries).
- **subtraction**: always needs borrowing. In grade 4 it can borrow across zeros (e.g. 3005 − 1278).

Each challenge includes a `challenge_token` (signed with HMAC). The server keeps nothing between requests.

### `POST /api/validate`
```json
{ "module": "value", "target": 352, "client_composition": { "hundreds": 3, "tens": 5, "units": 2 } }
{ "module": "addition", "operands": [357, 268], "client_answer": { "hundreds": 6, "tens": 2, "units": 5 },
  "client_regroups": { "tens": true, "hundreds": true }, "attempt": 1, "challenge_token": "…" }
```
The server always works out the answer itself. If a `challenge_token` is sent, the server uses the numbers inside the token and ignores the ones the client sent.

`client_regroups[place] = true` means the child marked a regroup between this column and the one to its right:
- In addition, it is the carried "1" written above the column.
- In subtraction, it means this column lent 1 to the column on its right.

Response:
```json
{ "correct": true, "stars_earned": 3, "coins_earned": 30,
  "feedback_message": "¡Perfecto! …", "feedback": { "hint": null, "columns": [ … ], "attempt": 1 },
  "solution": { … }, "verified_challenge": true,
  "reward": { "stars": 3, "coins": 30, "nonce": "…", "token": "…" } }
```

**Star rules**
- Correct answer with the fewest blocks, or with the right carry/borrow marks: 3 ★.
- Correct answer built a longer way (for example 2 hundreds + 15 tens) or with wrong carry/borrow marks: 2 ★.
- Each extra attempt costs 1 ★. The minimum for a correct answer is 1 ★.

**Hints**
- 1st try: the hint names the column to check.
- 2nd try: it explains that column step by step.
- 3rd try onward: the full solution is shown.

## Persistence
- All player progress lives in `localStorage['math_game_progression']`: stars, coins, level, grade, unlocked portals and stats.
- Points are only added after a correct answer from the server.
- Each reward `nonce` is saved, so the same reward can't be added twice.

**Portals**
- Level = 1 + ⌊stars / 6⌋.
- Addition opens at level 2.
- Subtraction opens at level 3.
