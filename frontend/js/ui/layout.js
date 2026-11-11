/**
 * Responsive HUD controller.
 *
 * The LAYOUT itself is decided by CSS media queries (css/app.css exposes it as
 * --hud-layout: sidebar | drawer | sheet). This module only:
 *   - opens/closes the drawer or sheet (handle tap, swipe, pull tab)
 *   - re-opens it when the HUD needs attention (feedback, toasts)
 *   - tells the 3D engine how much of the screen the HUD covers, so the scene
 *     re-centers in the free area (smoothly, while the panel slides)
 */
export function initLayout({ panel, handle, tab, engine }) {
  let open = true;
  let lastLayout = null;

  const layout = () => getComputedStyle(document.documentElement).getPropertyValue('--hud-layout').trim() || 'sidebar';
  const peek = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-peek')) || 72;

  function syncInset() {
    const mode = layout();
    if (mode === 'sheet') engine.setInset({ bottom: open ? panel.offsetHeight : peek() });
    else if (mode === 'drawer') engine.setInset({ left: open ? panel.offsetWidth : 0 });
    else engine.setInset({ left: panel.offsetWidth });
  }

  function setOpen(value) {
    open = value || layout() === 'sidebar';
    panel.dataset.open = String(open);
    const label = open ? 'Ocultar panel' : 'Mostrar panel';
    for (const b of [handle, tab]) {
      b.setAttribute('aria-expanded', String(open));
      b.setAttribute('aria-label', label);
    }
    tab.textContent = open ? '‹' : '›';
    syncInset();
  }

  // Sheet handle: tap toggles, vertical swipe opens/closes.
  let startY = null;
  let swiped = false;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; swiped = false; });
  handle.addEventListener('pointerup', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (Math.abs(dy) > 14) { swiped = true; setOpen(dy < 0); }
  });
  handle.addEventListener('click', () => { if (swiped) { swiped = false; return; } setOpen(!open); });
  tab.addEventListener('click', () => setOpen(!open));

  // The sheet grows/shrinks with its content (feedback card, toasts…).
  new ResizeObserver(syncInset).observe(panel);

  const relayout = () => {
    const mode = layout();
    if (mode !== lastLayout) { lastLayout = mode; setOpen(true); } else syncInset();
  };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  window.addEventListener('hud:attention', () => { if (!open) setOpen(true); });

  relayout();
  return { setOpen, isOpen: () => open, layout };
}
