// "Say or type": turns a sentence such as "2 Meiji milk in the fridge expires 25 Oct, eggs and 3 tins of sardines"
// into items to confirm. No AI and nothing leaves the phone: plain rules pick out the quantity, where it's kept and
// the date, and the rest is matched against the household's own items and the catalogue (catalogue.js), which fill in
// the brand, category, usual place and "keeps once opened". Speech comes from the phone's own speech-to-text
// (listen() below, or the keyboard's microphone where the browser has no speech recognition).
// Pure functions apart from listen(), so test/quick.test.mjs runs them in Node.
import { ymd, addDays, parseYmd, score } from './logic.js';
import { DEFAULT_PLACES } from './places.js';
import { LOCATIONS } from './catalogue.js';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Everyday words for the catalogue's generic places (catalogue.js LOCATIONS). The household's own list (places.js)
// is matched first, by its names ("level 1 fridge", "basement store", or "basement" for a place the family added).
const PLACES = [
  [/\b(freezer|frozen)\b/, 'Freezer'],
  [/\b(fridge|refrigerator|chiller)\b/, 'Fridge'],
  [/\b(store ?room|storeroom|bomb shelter)\b/, 'Store room'],
  [/\b(medicine (box|cabinet)|first aid( box)?)\b/, 'Medicine box'],
  [/\b(bathroom|toilet)\b/, 'Bathroom'],
  [/\b(laundry|service yard)\b/, 'Laundry'],
  [/\b(kitchen )?(cabinet|cupboard|pantry|shelf|larder)\b/, 'Kitchen cabinet'],
];
const UNITS = /\b(packs?|packets?|bottles?|cartons?|cans?|tins?|boxes|box|bags?|jars?|tubs?|loaf|loaves|rolls?|bars?|sachets?|pieces?|pcs|units?|trays?|bunch(es)?|kg|g|ml|l)\b(\s+of\b)?/g;
const FILLER = /\b(i|we|bought|got|have|added|add|put|some|the|and|also|plus|in|into|inside|at|on|to|of|with|please)\b/g;

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The last word of a place that only says what kind of place it is: "Basement store" can be said as "basement".
const KIND_WORDS = new Set(['store', 'storeroom', 'room', 'cabinet', 'cupboard', 'box', 'shelf', 'shelves', 'area', 'rack', 'drawer']);
const GENERIC = new Set(LOCATIONS.map(p => p.toLowerCase()));
// One pattern per way of saying each place: [regex, place], longest first. Digits match their word ("level one").
export function placeMatchers(places = DEFAULT_PLACES) {
  const words = n => n.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
  const pat = ws => ws.map(w => (/^\d+$/.test(w) && DIGIT[+w] ? `(?:${w}|${DIGIT[+w]})` : reEsc(w))).join('\\s+');
  const out = [];
  for (const p of places) {
    if (!p || /^other$/i.test(p)) continue;
    const ws = words(p);
    if (!ws.length) continue;
    out.push([ws.join(' ').length, ws, p]);
    // a place the family added, said without its last word ("basement" for "Basement store")
    if (!GENERIC.has(p.toLowerCase()) && ws.length > 1 && KIND_WORDS.has(ws.at(-1))) {
      const short = ws.slice(0, -1);
      if (!short.every(w => KIND_WORDS.has(w))) out.push([short.join(' ').length, short, p]);
    }
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, ws, p]) => [new RegExp(`(?<![\\p{L}\\p{N}])${pat(ws)}(?![\\p{L}\\p{N}])`, 'u'), p]);
}
// Where something is kept, from the words said: { place, re } or null. The household's own names win; then the
// everyday words, landing on the generic place if the household has it, else on one of its places of that kind
// ("fridge" -> "Level 1 fridge" when there is no plain Fridge), else the generic name.
export function findPlace(text, places = DEFAULT_PLACES) {
  for (const [re, place] of placeMatchers(places)) if (re.test(text)) return { place, re };
  for (const [re, generic] of PLACES) {
    if (!re.test(text)) continue;
    const g = generic.toLowerCase();
    const kind = g.split(' ').at(-1) === 'cabinet' ? 'cabinet' : g.split(' ')[0];
    const place = places.find(p => p.toLowerCase() === g) || places.find(p => p.toLowerCase().split(/\s+/).includes(kind)) || generic;
    return { place, re };
  }
  return null;
}

const pad = n => String(n).padStart(2, '0');
// A day and month (no year): this year, or next year if that date is more than two months gone (a best-before date
// is nearly always in the future, but a just-expired one can be typed in too).
function dayMonth(d, m, today) {
  const t = parseYmd(today);
  let y = t.getFullYear();
  if (`${y}-${pad(m)}-${pad(d)}` < addDays(today, -60)) y++;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return parseYmd(s) && parseYmd(s).getMonth() === m - 1 ? s : null;
}
const year4 = y => (y < 100 ? 2000 + y : y);
const lastDay = (y, m) => ymd(new Date(y, m, 0));

// Finds a date in the text: { date: 'YYYY-MM-DD', text: the words it used } or null.
export function findDate(text, today = ymd()) {
  const lead = String.raw`(?:(?:expires?|expiring|expiry|exp|best before|use by|good till|good until|until|till|by|before|on)\s+)?`;
  const mon = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
  const tries = [
    [new RegExp(lead + String.raw`(\d{4})-(\d{1,2})-(\d{1,2})\b`, 'i'), m => { const s = `${m[1]}-${pad(m[2])}-${pad(m[3])}`; return parseYmd(s) ? s : null; }],
    [new RegExp(lead + String.raw`(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b`, 'i'), m => {
      if (!m[3]) return dayMonth(+m[1], +m[2], today);
      const s = `${year4(+m[3])}-${pad(m[2])}-${pad(m[1])}`; return parseYmd(s) && parseYmd(s).getDate() === +m[1] ? s : null;
    }],
    [new RegExp(lead + String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?` + mon + String.raw`(?:\s+(\d{4}))?\b`, 'i'), m => {
      const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
      if (m[3]) { const s = `${m[3]}-${pad(mo)}-${pad(m[1])}`; return parseYmd(s) ? s : null; }
      return dayMonth(+m[1], mo, today);
    }],
    [new RegExp(lead + mon + String.raw`\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'i'), m => {
      const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      if (m[3]) { const s = `${m[3]}-${pad(mo)}-${pad(m[2])}`; return parseYmd(s) ? s : null; }
      return dayMonth(+m[2], mo, today);
    }],
    // "March 2028", "03/2028": packs often print only the month; take its last day
    [new RegExp(lead + mon + String.raw`\s+(\d{4})\b`, 'i'), m => lastDay(+m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)],
    [new RegExp(lead + String.raw`(\d{1,2})/(\d{4})\b`, 'i'), m => (+m[1] >= 1 && +m[1] <= 12 ? lastDay(+m[2], +m[1]) : null)],
    [new RegExp(lead + String.raw`(?:in\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?|months?|years?)(?:\s+time)?\b`, 'i'), m => {
      const n = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1].toLowerCase()];
      const per = { d: 1, w: 7, m: 30, y: 365 }[m[2][0].toLowerCase()];
      return addDays(today, n * per);
    }],
    [new RegExp(lead + String.raw`next\s+(week|month|year)\b`, 'i'), m => addDays(today, { week: 7, month: 30, year: 365 }[m[1].toLowerCase()])],
    [new RegExp(lead + String.raw`(today|tonight|tomorrow|tmr)\b`, 'i'), m => addDays(today, /^to(day|night)/i.test(m[1]) ? 0 : 1)],
  ];
  for (const [re, fn] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (date) return { date, text: m[0] };
  }
  return null;
}

// Splits a sentence into one piece per item ("milk, eggs and 3 tins of sardines").
export function splitItems(text) {
  return String(text || '')
    .replace(/\b(and then|then)\b/gi, ',')
    .split(/\s*(?:[\n,;]|\band\b|\bplus\b|\balso\b)\s*/i)
    .map(s => s.trim())
    .filter(s => /[a-z]/i.test(s));
}

const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

// One piece -> { name, qty, location, expiry, match } where match is { mine } (an item already at home: adds stock)
// or { cat } (a catalogue product: fills in its details) or null (a new item with just the name).
// places: the household's list (places.js), defaults when not given.
export function parseOne(piece, { today = ymd(), items = [], catalogue = [], places = DEFAULT_PLACES } = {}) {
  let t = ` ${piece.toLowerCase()} `;
  const d = findDate(t, today);
  if (d) t = t.replace(d.text.toLowerCase(), ' ');
  let location = '';
  const pl = findPlace(t.replace(/[‘’]/g, "'"), places);
  if (pl) { location = pl.place; t = t.replace(/[‘’]/g, "'").replace(pl.re, ' '); }
  let qty = 1;
  const q = /(?:^|\s)(?:x\s*)?(\d{1,3})\s*x?(?=\s)|\b(a dozen|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\b/.exec(t);
  if (q) { qty = q[1] ? Math.max(1, +q[1]) : NUM[q[2].replace('a dozen', 'dozen')]; t = t.replace(q[0], ' '); }
  const name = t.replace(UNITS, ' ').replace(FILLER, ' ').replace(/[^\p{L}\p{N}'& -]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  let best = null;
  for (const it of items) { const s = score(name, `${it.name} ${it.brand || ''}`); if (s && (!best || s + 2 > best.s)) best = { s: s + 2, mine: it }; }
  for (const c of catalogue) { const s = score(name, `${c.name} ${c.brand}`); if (s && (!best || s > best.s)) best = { s, cat: c }; }
  const m = best?.mine || best?.cat;
  return {
    name: m ? m.name : title(name), brand: m?.brand || '', qty, expiry: d?.date || '',
    location: location || m?.location || '', match: best ? (best.mine ? { mine: best.mine } : { cat: best.cat }) : null, heard: piece.trim(),
  };
}

export function parseQuick(text, opts = {}) {
  return splitItems(text).map(p => parseOne(p, opts)).filter(Boolean);
}

// ---- speech -----------------------------------------------------------------------------------------------------

// The browser's own speech-to-text (Chrome on Android, Safari on iPhone), in Singapore English.
export const canListen = () => !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);

// Starts listening; onText(fullText, final) is called as words arrive. Returns { stop() }. onEnd(error?) when done.
export function listen({ onText, onEnd, lang = 'en-SG' }) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const r = new SR();
  r.lang = lang; r.interimResults = true; r.continuous = true;
  r.onresult = e => {
    let text = '', final = true;
    for (const res of e.results) { text += res[0].transcript; if (!res.isFinal) final = false; }
    onText(text.trim(), final);
  };
  r.onerror = e => onEnd?.(e.error || 'error');
  r.onend = () => onEnd?.();
  r.start();
  return { stop: () => { try { r.stop(); } catch { /* already stopped */ } } };
}
