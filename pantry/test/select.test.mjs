// Selecting items (js/select.js): the selection as state (by id), and the press and hold with a fake pointer.
import assert from 'node:assert/strict';
import { newSel, startSel, endSel, isSel, toggleSel, setMany, selectAll, selectNone, pruneSel, groupState, selText, chosen, holdToSelect } from '../js/select.js';

// ---- the selection ----
const s = newSel();
assert.equal(s.on, false); assert.equal(s.ids.size, 0);
startSel(s, 'a');
assert.deepEqual([s.on, [...s.ids]], [true, ['a']], 'a hold starts with that row ticked');
assert.equal(toggleSel(s, 'b'), true); assert.equal(toggleSel(s, 'a'), false);
assert.deepEqual([...s.ids], ['b']);
assert.equal(setMany(s, ['b', 'c', 'd'], true), 2, 'only the new ones count');
assert.equal(setMany(s, ['c', 'x'], false), 1);
assert.deepEqual([...s.ids].sort(), ['b', 'd']);
assert.equal(groupState(s, ['b', 'd']), 'all'); assert.equal(groupState(s, ['b', 'z']), 'some'); assert.equal(groupState(s, ['z']), 'none'); assert.equal(groupState(s, []), 'none');
assert.equal(selectAll(s, ['p', 'q', 'r']), 3); assert.deepEqual([...s.ids], ['p', 'q', 'r'], 'select all is exactly the list given (the whole filtered result)');
assert.equal(pruneSel(s, ['p', 'r']), 1, 'what another phone deleted drops out'); assert.deepEqual([...s.ids], ['p', 'r']);
assert.equal(pruneSel(s, new Set(['p', 'r', 'z'])), 0);
selectNone(s); assert.equal(s.on, true, 'Select none keeps selecting'); assert.equal(s.ids.size, 0);
assert.equal(selText(0), 'None selected'); assert.equal(selText(3), '3 selected'); assert.equal(selText(5, 2), '5 selected (2 not shown)'); assert.equal(selText(0, 2), 'None selected');
startSel(s, 'p'); setMany(s, ['q'], true);
assert.deepEqual(chosen(s, [{ id: 'q' }, { id: 'x' }, { id: 'p' }]).map(x => x.id), ['q', 'p'], 'in the list’s order, only those still there');
endSel(s); assert.deepEqual([s.on, s.ids.size], [false, 0]);

// ---- press and hold, with a fake pointer ----
// a tiny DOM: a root holding a row (a link) with a grip button and a plain child
const mk = (cls = [], kids = [], parent = null) => {
  const el = Object.assign(new EventTarget(), { classList: { set: new Set(cls), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, has(c) { return this.set.has(c); } }, kids, parent, contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; } });
  el.matches = sel => sel.split(',').some(x => { x = x.trim(); return x.startsWith('.') ? el.classList.has(x.slice(1)) : el.tag === x; });
  el.closest = sel => { for (let n = el; n; n = n.parent) if (n.matches(sel)) return n; return null; };
  for (const k of kids) k.parent = el;
  return el;
};
const root = mk(['list']), row = mk(['pa-item'], [], root), grip = mk(['pa-grip'], [], row), text = mk([], [], row), btn = Object.assign(mk([], [], row), { tag: 'button' });
row.tag = 'a';
const win = new EventTarget();
const log = [];
const h = holdToSelect(root, { ms: 40, slop: 10, win, start: (el, e) => log.push(['start', el === row]), cue: el => log.push(['cue']), haptic: () => log.push(['buzz']) });
const ev = (type, target, x = 0, y = 0, extra = {}) => { const e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, button: 0, isPrimary: true, ...extra }); Object.defineProperty(e, 'target', { value: target }); root.dispatchEvent(e); return e; };   // (a fake tree has no bubbling: events go to the root with their target set)
const nap = ms => new Promise(r => setTimeout(r, ms));
const clicks = [];
win.addEventListener('click', e => clicks.push('click'));

// a hold: after ms it starts, buzzes, cues, and swallows the click that follows
log.length = 0; ev('pointerdown', text, 5, 5);
assert.equal(row.classList.has('is-holding'), true, 'the row shows it is being held');
await nap(80);
assert.deepEqual(log.map(x => x[0]).sort(), ['buzz', 'cue', 'start'], 'a hold of half a second: buzz, cue, start');
assert.equal(log.find(x => x[0] === 'start')[1], true);
assert.equal(row.classList.has('is-holding'), false);
ev('pointerup', text, 5, 5);
const swallowed = Object.assign(new Event('click', { bubbles: true, cancelable: true }), {});
win.dispatchEvent(swallowed);
assert.equal(swallowed.defaultPrevented, true, 'the click after a hold is swallowed (the row’s link does not open)');
const second = new Event('click', { cancelable: true }); win.dispatchEvent(second);
assert.equal(second.defaultPrevented, false, 'only that one click');

// the row's own link is not excluded: pressing on its text works (above); the grip, buttons and inputs keep their own press
for (const t of [grip, btn]) { log.length = 0; ev('pointerdown', t, 5, 5); await nap(80); assert.deepEqual(log, [], 'the grip and buttons do not start a hold'); ev('pointerup', t); }

// a short press is a tap
log.length = 0; ev('pointerdown', text, 5, 5); await nap(10); ev('pointerup', text, 5, 5); await nap(80);
assert.deepEqual(log, [], 'a tap does nothing here');
// 10 px of movement cancels, 9 does not
log.length = 0; ev('pointerdown', text, 5, 5); ev('pointermove', text, 5, 16); await nap(80);
assert.deepEqual(log, [], 'more than 10 px cancels the hold');
ev('pointerup', text);
log.length = 0; ev('pointerdown', text, 5, 5); ev('pointermove', text, 5, 14); await nap(80);
assert.deepEqual(log.map(x => x[0]).sort(), ['buzz', 'cue', 'start'], '9 px of wobble is still a hold');
ev('pointerup', text);
// a scroll or a cancelled pointer cancels
log.length = 0; ev('pointerdown', text, 5, 5); win.dispatchEvent(new Event('scroll')); await nap(80);
assert.deepEqual(log, [], 'a scroll cancels');
log.length = 0; ev('pointerdown', text, 5, 5); ev('pointercancel', text); await nap(80);
assert.deepEqual(log, [], 'a cancelled pointer (a scroll starting on a touch screen) cancels');
// a right button or a second finger does not start one
log.length = 0; ev('pointerdown', text, 5, 5, { button: 2 }); await nap(80); assert.deepEqual(log, []);
ev('pointerdown', text, 5, 5, { isPrimary: false }); await nap(80); assert.deepEqual(log, []);
// Android's long press: contextmenu while holding is the hold (and its menu is blocked); right after a hold the menu is blocked too
log.length = 0; ev('pointerdown', text, 5, 5);
const menu = ev('contextmenu', text, 5, 5);
assert.equal(menu.defaultPrevented, true); assert.deepEqual(log.map(x => x[0]).sort(), ['buzz', 'cue', 'start'], 'contextmenu starts it at once');
await nap(80); assert.equal(log.filter(x => x[0] === 'start').length, 1, 'and only once');
assert.equal(ev('contextmenu', text, 5, 5).defaultPrevented, true, 'the menu right after a hold is blocked');
ev('pointerup', text);
await nap(1100);
assert.equal(ev('contextmenu', text, 5, 5).defaultPrevented, false, 'a long while later the browser’s own menu is left alone');
// outside the list nothing happens
const other = mk(['x']); log.length = 0; ev('pointerdown', other, 1, 1); await nap(80); assert.deepEqual(log, []);
h.destroy();
log.length = 0; ev('pointerdown', text, 5, 5); await nap(80); assert.deepEqual(log, [], 'destroyed: no more holds');
console.log('pantry select: ok');
