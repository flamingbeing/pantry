// Dragging by the grip (16 Oct 2026, Items list PR). Adapted from the anawj.com logbook's best drag (Reflections: a ghost that
// follows the pointer, the heading under it lit, auto-scroll at the edges, pointer events so touch works on iOS) with what a pantry
// phone needs: the ghost is lifted ABOVE the finger so it isn't hidden, a label says where it will land, a tick on every new
// target (the kit's haHaptic: Android only, never with reduced motion), and Escape, a cancelled pointer or a drop on nothing puts
// everything back. Every drag starts from a grip button (`touch-action: none` in the CSS, so the browser never scrolls from it); a
// tap on the grip, without moving, is left alone (the app opens its Move sheet).
//
// This file knows nothing about items: the app says what is under the pointer (`hit`) and what a drop does (`drop`).
//
//   startDrag(e, {
//     handle,            the grip (default e.currentTarget); it captures the pointer
//     ghost,             an element to copy as the ghost (a row), or null for a card with `text`
//     text,              the card's words ("3 items") when there is no `ghost`
//     hit(x, y, under),  -> null (nothing to drop on), or { key, el?, tip, line?, drop } for what is under the pointer:
//                        `el` is lit (class pa-drop), `tip` is the label, `line` { y, left, width } draws an insertion line,
//                        `key` tells one target from another (a tick when it changes), `drop` is handed to onDrop (null: only a tip)
//     onDrop(drop),      the drop
//     onEnd(dropped),    after everything is cleaned up (also when cancelled)
//     haptic(),          a tick
//     slop = 6           px to move before it counts as a drag (less is a tap)
//   }) -> { cancel() }

const EDGE = 70;          // px from the top or bottom edge that scrolls the page
const MAX_SCROLL = 22;    // px per frame

export function startDrag(e, o = {}) {
  const handle = o.handle || e.currentTarget || e.target;
  const slop = o.slop ?? 6;
  if (e.pointerType === 'mouse' && e.button !== 0) return { cancel() {} };
  let active = false, ended = false, x = e.clientX, y = e.clientY, raf = 0;
  const x0 = x, y0 = y;
  let ghost = null, tip = null, line = null, lit = null, cur = null;
  const doc = handle.ownerDocument, win = doc.defaultView;
  try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

  const begin = () => {
    active = true;
    ghost = doc.createElement('div');
    ghost.className = 'pa-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    if (o.ghost) {
      const box = o.ghost.getBoundingClientRect();
      const copy = o.ghost.cloneNode(true);
      for (const n of copy.querySelectorAll('[id]')) n.removeAttribute('id');
      for (const n of copy.querySelectorAll('input, button, a')) { n.tabIndex = -1; }
      ghost.append(copy);
      ghost.style.width = Math.min(box.width, win.innerWidth - 16) + 'px';
    } else {
      const c = doc.createElement('div'); c.className = 'pa-ghost-card'; c.textContent = o.text || '';
      ghost.append(c);
    }
    tip = doc.createElement('div'); tip.className = 'pa-ghost-tip'; ghost.append(tip);
    doc.body.append(ghost);
    doc.body.classList.add('pa-dragging');
    o.ghost?.classList.add('is-dragging');
    place();
    raf = win.requestAnimationFrame(tick);
  };
  const place = () => {
    if (!ghost) return;
    const w = ghost.offsetWidth, h = ghost.offsetHeight;
    // lifted above the finger (its bottom edge 18 px above it), kept on the screen
    const left = Math.max(8, Math.min(win.innerWidth - w - 8, o.ghost ? o.ghost.getBoundingClientRect().left : x - w / 2));
    const top = Math.max(4, y - h - 18);
    ghost.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    // what is under the finger (the ghost itself never takes the pointer: pointer-events none)
    const under = doc.elementFromPoint(x, y);
    const res = o.hit ? o.hit(x, y, under) : null;
    const key = res ? res.key ?? '' : null;
    if (key !== cur) { cur = key; if (res?.drop) o.haptic?.(); }
    const el = res?.el || null;
    if (el !== lit) { lit?.classList.remove('pa-drop'); lit = el; lit?.classList.add('pa-drop'); }
    tip.textContent = res?.tip || '';
    tip.hidden = !res?.tip;
    ghost.classList.toggle('is-ready', !!res?.drop);
    if (res?.line) {
      if (!line) { line = doc.createElement('div'); line.className = 'pa-dropline'; line.setAttribute('aria-hidden', 'true'); doc.body.append(line); }
      line.style.transform = `translate(${Math.round(res.line.left)}px, ${Math.round(res.line.y - 1.5)}px)`;
      line.style.width = Math.round(res.line.width) + 'px';
    } else if (line) { line.remove(); line = null; }
    last = res;
  };
  let last = null;
  // auto-scroll near the top or bottom edge (above the tab bar and the selection bar, below the top bar)
  const tick = () => {
    if (!active || ended) return;
    const topEdge = (doc.querySelector('.ha-bar')?.getBoundingClientRect().bottom || 0) + EDGE * 0.5;
    const bars = [doc.querySelector('.ha-tabbar'), doc.querySelector('#pa-selbar')].filter(Boolean).map(b => b.getBoundingClientRect()).filter(r => r.width > 100 && r.top > win.innerHeight / 2);
    const bottomEdge = Math.min(win.innerHeight, ...bars.map(r => r.top)) - EDGE * 0.5;
    let v = 0;
    if (y < topEdge + EDGE * 0.5) v = -Math.ceil((topEdge + EDGE * 0.5 - y) / 3);
    else if (y > bottomEdge - EDGE * 0.5) v = Math.ceil((y - (bottomEdge - EDGE * 0.5)) / 3);
    if (v) { win.scrollBy(0, Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, v))); place(); }
    raf = win.requestAnimationFrame(tick);
  };
  const move = ev => {
    if (ev.pointerId !== e.pointerId) return;
    x = ev.clientX; y = ev.clientY;
    if (!active) { if (Math.hypot(x - x0, y - y0) > slop) begin(); else return; }
    ev.preventDefault?.();
    place();
  };
  const stopTouch = ev => { if (active && ev.cancelable) ev.preventDefault(); };   // iOS: no scrolling or rubber-banding under a drag
  const esc = ev => { if (ev.key === 'Escape' && active) { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
  const end = ev => { if (ev.pointerId !== e.pointerId) return; finish(ev.type === 'pointerup'); };
  function finish(drop) {
    if (ended) return;
    ended = true;
    win.cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
    doc.removeEventListener('touchmove', stopTouch, { capture: true }); win.removeEventListener('keydown', esc, { capture: true });
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const res = last;
    ghost?.remove(); line?.remove(); lit?.classList.remove('pa-drop'); o.ghost?.classList.remove('is-dragging');
    doc.body.classList.remove('pa-dragging');
    const dropped = !!(drop && active && res?.drop);
    if (active) o.suppressClick?.();   // lifting the finger after a drag is not a tap on the grip
    if (dropped) o.onDrop?.(res.drop);
    o.onEnd?.(dropped);
  }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  doc.addEventListener('touchmove', stopTouch, { capture: true, passive: false });
  win.addEventListener('keydown', esc, { capture: true });
  return { cancel: () => finish(false) };
}
