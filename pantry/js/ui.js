// Pantry's glue on the shared kit (@core/ui and @core/theme, app-ui, exact version in the imports below and in sw.js): the hash
// routes (pantry's own screens), sheets built on the kit's detentSheet, the kit's confirm modal, toasts and stepper.
// Every screen and every sheet is a history entry, so the iPhone edge swipe and Android back always do the expected
// thing. Icons come from the brand kit's sprite (design.flamingbeing.com/v1/icons.svg, the same shapes as before).
import {
  detentSheet, sheetsSettled, tabBarRoom, confirmModal, toaster, tabBack, CLOSE_MS, LABELS, stepper as kitStepper, haptic as kitHaptic, largeTitle as kitLargeTitle,
  pressFeedback, bounce, watchKeyboard, toggleTicks, syncButton, refusedList,
} from 'https://core.anawj.com/ui/1.0.0-rc.59/ui/index.js';
import { applyTheme, themeSwitch } from 'https://core.anawj.com/ui/1.0.0-rc.59/theme/index.js';

const doc = document;

// ---------- the look: this device's choice (Settings → This device), on pantry's own accent (the brand's slate blue) ----------
// iOS look unless this device picked another (Settings → This device)
applyTheme({ accent: '#3a6390', surface: 'cool', look: 'ios' }); // the old kit's cool grey ground (#f5f5f7)
// Settings → This device: look, light or dark, density, and glass or Solid bars and sheets (the kit's themeSwitch)
export const deviceSwitch = host => themeSwitch(host);

// the room the floating tab bar takes, under each screen's last row (--ui-tabbar-room, the kit's)
const watchTabs = () => { const t = doc.querySelector('.ui-tabbar'); if (t) tabBarRoom(t); };
if (doc.readyState === 'loading') addEventListener('DOMContentLoaded', watchTabs); else watchTabs();
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The kit's every-page parts, as its startGestures starts them: pressed at once, the rubber band at a scroll's ends, the
// keyboard watch, and a tick on a switch or segmented control. Not startGestures itself: its pushed-screen stack would
// take Back and the history state from pantry's own router (below); sheets, the large title and the tab bar are started
// here by name already. (iOS shows :active press states only when the page listens for touches.)
doc.addEventListener('touchstart', () => {}, { passive: true });
pressFeedback(doc); bounce(doc); watchKeyboard();
// the ticks only without reduced motion (pantry's rule for every buzz: haptic() below)
const calm = matchMedia('(prefers-reduced-motion: reduce)');
let stopTicks = null;
const ticks = () => { stopTicks?.(); stopTicks = calm.matches ? null : toggleTicks(doc); };
ticks(); calm.addEventListener?.('change', ticks);
export { syncButton, refusedList };

// ---------- icons: the brand kit's sprite, put in the page once (browsers refuse <use> across addresses) ----------
const SPRITE = 'https://design.flamingbeing.com/v1/icons.svg';
export const iconsReady = fetch(SPRITE)
  .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
  .then(svg => {
    const box = doc.createElement('div');
    // not display:none (some browsers then skip the symbols' paint); out of sight and out of the accessibility tree
    box.className = 'pa-sprite'; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = svg.replace(/<!--[\s\S]*?-->/g, '');
    (doc.body || doc.documentElement).prepend(box);
    return true;
  })
  .catch(() => false);
// An icon as markup. Decorative (aria-hidden) unless a label is given.
export function icon(name, { label = '', cls = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ui-icon${cls ? ' ' + esc(cls) : ''}" viewBox="0 0 24 24" ${a11y}><use href="#i-${esc(name)}"/></svg>`;
}

// ---------- small helpers ----------
// kind: the kit's tick, threshold, long, confirm or reject
export const haptic = (kind = 'tick') => { if (!reducedMotion()) kitHaptic(kind); };
// Say something to screen readers (one shared polite live region).
let liveEl = null;
export function announce(text) {
  if (!liveEl) { liveEl = doc.createElement('div'); liveEl.className = 'pa-sr'; liveEl.setAttribute('aria-live', 'polite'); doc.body.append(liveEl); }
  liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = text; }, 40);
}

// ---------- toasts (the kit's toaster): one at a time; 4 s, or 6 s with an action ----------
let toasts = null, hideShowing = null;
export function toast(text, { action = '', onAction, ms } = {}) {
  toasts ??= toaster(doc.body);
  hideShowing?.();
  hideShowing = toasts.show(text, { ms: ms ?? (action ? 6000 : 4000), ...(action ? { action: { label: action, run: () => onAction?.() } } : {}) });
  const mine = hideShowing;   // (hides this toast only, not a later one)
  return { hide: () => { if (hideShowing === mine) hideToast(); } };
}
export function hideToast() { hideShowing?.(); hideShowing = null; }

// ---------- sheets: dialog.ui-sheet on the kit's detentSheet ----------
// sheet({ title, body, footer, lead, closeLabel = 'Done', detent ('large'), grey, onClose(value) })
//   -> { el, close(value), closed } (closed: a Promise of the value). The kit pushes a history entry for it, so Back,
// Escape, the backdrop, dragging it down and Done close it. Buttons with [data-pa-close] close it with their value.
let sheetSeq = 0;
const open = [];   // { d, ctl, value, resolve, onClose }
export const sheetOpen = () => open.length > 0;
// once a closed sheet's history entry has popped (the address is the page's own again): the kit's
export { sheetsSettled };
export function sheet(o = {}) {
  const id = 'pa-sheet-' + (++sheetSeq);
  const d = doc.createElement('dialog');
  d.className = 'ui-sheet' + (o.grey ? ' pa-sheet--grey' : '');
  d.id = id;
  d.dataset.detents = o.detent === 'large' ? 'large' : 'medium large';
  d.setAttribute('aria-labelledby', id + '-t');
  d.innerHTML = `<button type="button" class="ui-sheet-grabber" aria-label="Expand or collapse"></button>
    <div class="ui-sheet-head">${o.lead || '<span></span>'}<h2 class="pa-sheet-title" id="${id}-t" tabindex="-1">${esc(o.title)}</h2><button type="button" data-pa-close>${esc(o.closeLabel || 'Done')}</button></div>
    <div class="ui-sheet-body"></div>`;
  const body = d.querySelector('.ui-sheet-body');
  if (o.body instanceof Node) body.append(o.body); else body.innerHTML = o.body || '';
  if (o.footer) {
    const f = doc.createElement('div'); f.className = 'pa-sheet-foot';
    if (o.footer instanceof Node) f.append(o.footer); else f.innerHTML = o.footer;
    body.append(f);
  }
  doc.body.append(d);
  const ctl = detentSheet(d);
  let resolve; const closed = new Promise(r => { resolve = r; });
  const s = { d, ctl, value: undefined, resolve, onClose: o.onClose };
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-pa-close]');
    if (b && d.contains(b)) { e.preventDefault(); s.value = b.value || undefined; ctl.close(); }
  });
  d.addEventListener('cancel', e => { e.preventDefault(); ctl.close(); });   // Escape
  d.addEventListener('close', () => finish(s));
  open.push(s);
  const from = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  ctl.open(from);   // (the kit takes its history entry once any sheet's step back has landed)
  const title = d.querySelector('h2');
  if (!d.querySelector('[autofocus]')) requestAnimationFrame(() => title.focus({ preventScroll: true }));
  const api = { el: d, close: v => closeSheet(d, v), closed };
  d._pa = api;
  return api;
}
function finish(s) {
  const i = open.indexOf(s); if (i < 0) return;
  open.splice(i, 1);
  s.ctl.stop();
  setTimeout(() => s.d.remove(), reducedMotion() ? 0 : 450);
  const v = s.value; s.value = undefined;
  s.onClose?.(v);
  s.resolve(v);
}
// Close a sheet (and pop its history entry). Resolves with its value once it has gone and its step back has landed.
export function closeSheet(d, value) {
  const s = open.find(x => x.d === d);
  if (!s) return Promise.resolve(value);
  s.value = value;
  const done = d._pa.closed.then(v => sheetsSettled().then(() => v));
  if (d.open) s.ctl.close(); else finish(s);
  return done;
}
// Close every sheet, then wait for their history entries to pop (a route change, a sign-out).
async function closeAllSheets() {
  if (!open.length) return;
  const all = [...open].reverse().map(s => closeSheet(s.d, s.value));
  await Promise.all(all);
  await sheetsSettled();
}

// A yes/no question (the kit's confirm modal). Resolves true for the main button.
export function confirm({ title, text = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return confirmModal(text, { title, danger, yes: ok, labels: { cancel } });
}

// ---------- screens: hash routes ----------
// router({ render, tabs, tabOf }) starts it: render(route) draws the screen for route = { hash, path, parts, nav },
// where nav is 'push', 'pop', 'tab' or 'none' (first paint). Links to '#/…' are followed here; tab links (inside
// tabs, '.ui-tabbar, .ui-sidebar') get aria-current="page" when the route's first part matches theirs; tabOf(route)
// names the tab for a pushed screen. go('#/item/3') pushes a screen; back('#/') goes back, or to the fallback.
// Tabs are Back as on Android (the kit's tabBack): going to a tab first takes away the screens pushed over it, then
// leaving the first tab ('#/') adds one entry and the other tabs only change its address, so Back on any other tab
// is the first tab and Back on the first tab asks "Press Back again to close", and a second Back within 2 s leaves the app.
let routes = null, current = null, title = null, tabTrail = null, unwinding = false;
const FIRST = '#/';
const depth = () => history.state?.paDepth || 0;
const keepTab = () => history.state?.uiTabBack ? { uiTabBack: 1 } : {};
function parse(hash) {
  const h = hash && hash.startsWith('#/') ? hash : '#/';
  const path = h.slice(1).split('?')[0];
  return { hash: h, path, parts: path.split('/').filter(Boolean) };
}
function paint(nav) {
  const route = { ...parse(location.hash), nav };
  if (current && current.hash === route.hash && nav !== 'none') return;
  current = route;
  const run = () => {
    routes.render(route);
    markTabs(route);
    if (nav !== 'none') scrollTo(0, 0);
    largeTitle();
  };
  transition(run, nav);
}
function markTabs(route) {
  const want = routes.tabOf ? parse(routes.tabOf(route)).parts[0] || '' : route.parts[0] || '';
  for (const a of doc.querySelectorAll(routes.tabs.split(',').map(t => t.trim() + ' a[href^="#/"]').join(','))) {
    const p = parse(a.getAttribute('href')).parts[0] || '';
    if (want === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
// Run fn (which changes the screen) inside a view transition (the browser's cross-fade); 'none' changes it at once.
export function transition(fn, nav = 'push') {
  if (!doc.startViewTransition || reducedMotion() || nav === 'none' || doc.visibilityState === 'hidden') { fn(); return Promise.resolve(); }
  const t = doc.startViewTransition(fn);
  t.ready.catch(() => {}); t.updateCallbackDone.catch(() => {});   // (a transition cut short, e.g. by a resize, is not an error)
  return t.finished.catch(() => {});
}
export function router({ render, tabs = '.ui-tabbar, .ui-sidebar', tabOf } = {}) {
  routes = { render, tabs, tabOf };
  // start on a real route ('#/'), so going back to the first screen never lands on a bare URL
  const start = parse(location.hash).hash;
  history.replaceState({ ...(history.state || {}), paDepth: depth() }, '', location.hash === start ? location.href : start);
  addEventListener('popstate', () => { if (unwinding) return; if (parse(location.hash).hash !== current?.hash) { for (const s of [...open]) closeSheet(s.d, s.value); paint('pop'); } });
  // follow in-app links ourselves, so each one is a history entry with a known depth
  doc.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    go(a.getAttribute('href'), { nav: a.closest(tabs) ? 'tab' : 'push' });
  });
  // Back on the first tab asks once more before leaving ("Press Back again to close"); `first`: whether the page starts there
  tabTrail = tabBack({
    history, events: window, first: start === FIRST,
    onFirst: () => { if (!unwinding) paint('pop'); },
    onClose: () => { toasts ??= toaster(doc.body); toasts.show(LABELS.backAgain, { ms: CLOSE_MS }); },
  });
  paint('none');
  swipeTabs();
  return { get route() { return current; }, refresh: () => { current = null; paint('none'); } };
}
// A sideways swipe on a tab's content moves to the next or previous tab (the tab bar's links, in order). Not from the
// screen edges (the system's Back gesture), a field, a dialog, a sheet, select mode, a sideways scroller or a pushed screen.
function swipeTabs() {
  const links = () => [...doc.querySelectorAll('.ui-tabbar a[href^="#/"]')].map(a => parse(a.getAttribute('href')).hash);
  const sideways = el => { for (; el && el !== doc.body; el = el.parentElement) { if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; } return false; };
  let from = null;
  doc.addEventListener('touchstart', e => {
    from = null;
    const t = e.touches[0], edge = Math.min(32, innerWidth / 14);
    if (e.touches.length !== 1 || t.clientX < edge || t.clientX > innerWidth - edge) return;
    if (open.length || depth() > 0 || history.state?.paSelect || !isTab(current?.hash)) return;
    if (e.target.closest('input, textarea, select, [contenteditable], dialog, [data-swipe-own], .ui-tabbar') || sideways(e.target)) return;
    from = { x: t.clientX, y: t.clientY, at: e.timeStamp };
  }, { passive: true });
  doc.addEventListener('touchend', e => {
    const f = from; from = null;
    const t = e.changedTouches[0];
    if (!f || getSelection()?.toString()) return;
    const dx = t.clientX - f.x, dy = t.clientY - f.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || e.timeStamp - f.at > 600) return;
    const tabs = links(), i = tabs.indexOf(current.hash), j = i + (dx < 0 ? 1 : -1);
    if (i >= 0 && tabs[j]) go(tabs[j], { nav: 'tab' });
  }, { passive: true });
}
// a tab's own address (a link in the tab bar or side bar), not a screen pushed over one
const isTab = h => [...doc.querySelectorAll(routes.tabs.split(',').map(t => t.trim() + ' a[href^="#/"]').join(','))]
  .some(a => parse(a.getAttribute('href')).hash === h);
export function go(hash, { replace = false, nav = 'push' } = {}) {
  const h = parse(hash).hash;
  if (!routes) { location.hash = h; return Promise.resolve(); }
  if (h === current?.hash) return Promise.resolve();
  if (isTab(h)) return (open.length ? closeAllSheets() : sheetsSettled()).then(() => toTab(h, nav === 'pop' ? 'pop' : 'tab'));
  const move = () => {
    const d = replace ? depth() : depth() + 1;
    // (uiScreens tells tabBack that this entry is a screen over the tab, so closing it is not "Back on the first tab")
    const state = { ...(replace ? keepTab() : {}), paDepth: d, ...(d > 0 ? { uiScreens: d } : {}) };
    if (replace) history.replaceState(state, '', h); else history.pushState(state, '', h);
    paint(nav);
  };
  // a sheet's entry is popped first, so the new screen takes its place in history
  // (it moves a tick later: a caller that opens a sheet next awaits it, or the move would take the sheet's entry)
  return (open.length ? closeAllSheets() : sheetsSettled()).then(move);
}
export function back(fallback = '#/') {
  if (depth() > 0) history.back();
  else { history.replaceState({ ...keepTab(), paDepth: 0 }, '', parse(fallback).hash); paint('pop'); }
}
// Go to a tab: Back first takes away the screens pushed over the current tab (and a select mode's entry, which keeps
// the depth under it) without painting them, then tabBack moves between the tab entries.
function toTab(h, nav) {
  const steps = depth() + (history.state?.paSelect ? 1 : 0);
  if (steps > 0) {
    return new Promise(done => {
      unwinding = true;
      addEventListener('popstate', () => { unwinding = false; done(); }, { once: true });
      history.go(-steps);
    }).then(() => toTab(h, nav));
  }
  const first = h === FIRST;
  if (first && tabTrail.away()) {   // went() goes Back to the first tab's entry; the popstate paints it
    return new Promise(done => { addEventListener('popstate', () => done(), { once: true }); tabTrail.went(true); });
  }
  tabTrail.went(first, h);
  if (parse(location.hash).hash !== current?.hash) paint(nav);
  return Promise.resolve();
}

// ---------- the large title that collapses into the bar (the kit's largeTitle) ----------
export function largeTitle() {
  const bar = doc.querySelector('.ui-bar'); if (!bar) return;
  const big = [...doc.querySelectorAll('.ui-large-title')].find(el => el.getClientRects().length) || null;
  if (!title) title = kitLargeTitle(bar, big);
  else title.watch(big);
  if (!big) bar.classList.add('is-collapsed');
}

// ---------- stepper (the kit's .ui-stepper: a number field between - and + buttons) ----------
// Markup: stepperHtml({ id, label: 'Quantity', value, min, max }); stepper(el, { min, max, onChange }) -> { get(), set(v) }
export function stepperHtml({ id, labelledby, value = 0, min = 0, max = 99 }) {
  return `<div class="ui-stepper" role="group" aria-labelledby="${esc(labelledby)}" id="${esc(id)}"><button type="button" data-step="-1" aria-label="Fewer">${icon('minus')}</button><input type="number" inputmode="numeric" aria-labelledby="${esc(labelledby)}" min="${min}" max="${max}" step="1" value="${Number(value) || 0}"><button type="button" data-step="1" aria-label="More">${icon('plus')}</button></div>`;
}
export function stepper(el, { min = 0, max = 99, onChange } = {}) {
  const field = el.querySelector('input');
  field.min = String(min); field.max = String(max);
  const clamp = v => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
  const get = () => clamp(field.value);
  const set = v => { field.value = String(clamp(v)); };
  kitStepper(el);
  let last = get();
  field.addEventListener('input', () => { const v = get(); if (v === last || field.value === '') return; last = v; haptic(); onChange?.(v); });
  field.addEventListener('change', () => { const v = get(); set(v); if (v !== last) { last = v; onChange?.(v); } });
  return { get, set };
}

// ---------- the app version line (end of Settings) ----------
// version(el, 'pantry') fills el with "App version 2026-10-14 (3f9a2c1d)" (read from the cache named
// 'pantry-2026-10-14-3f9a2c1d') and "Not updating? Get the latest version": that fetches sw.js with cache: 'no-store'
// first (no signal: it says so and changes nothing), then unregisters only this app's service worker, deletes only
// caches starting 'pantry-', and reloads. Saved data (localStorage, IndexedDB, sign-in) is never touched.
export async function version(el, prefix, { swUrl = 'sw.js', reload = () => location.reload() } = {}) {
  if (!el) return;
  const pre = prefix.endsWith('-') ? prefix : prefix + '-';
  el.classList.add('pa-version');
  el.innerHTML = '<p class="pa-version-text" hidden></p><button type="button" class="pa-version-btn">Not updating? Get the latest version</button><p class="pa-version-msg" role="status"></p>';
  const text = el.querySelector('.pa-version-text'), btn = el.querySelector('.pa-version-btn'), msg = el.querySelector('.pa-version-msg');
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.textContent = 'Checking…';
    const sw = new URL(swUrl, location.href);
    let res = null;
    try {
      const check = new URL(sw); check.searchParams.set('pa-check', Date.now());
      res = await fetch(check, { cache: 'no-store' });
    } catch { /* offline */ }
    if (!res?.ok) {
      msg.textContent = res ? 'The app could not be reached, so nothing was changed. Try again later.'
        : 'No signal, so nothing was changed. Try again when you are online.';
      btn.disabled = false; return;
    }
    try {
      if ('serviceWorker' in navigator) {
        for (const reg of await navigator.serviceWorker.getRegistrations()) {
          const urls = [reg.active, reg.waiting, reg.installing].filter(Boolean).map(w => w.scriptURL.split('?')[0]);
          if (urls.includes(sw.href.split('?')[0])) await reg.unregister();
        }
      }
      if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith(pre)) await caches.delete(k);
    } catch { /* storage blocked: reloading still fetches fresh files */ }
    msg.textContent = 'Getting the latest version…';
    reload();
  });
  try {
    const key = ('caches' in window) ? (await caches.keys()).find(k => k.startsWith(pre)) : null;
    if (key) {
      const v = key.slice(pre.length), m = v.match(/^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/);
      text.textContent = 'App version ' + (m ? `${m[1]} (${m[2]})` : v);
      text.hidden = false;
    }
  } catch { /* no cache storage (private window, old browser): no version line */ }
}
