// Barcode scanning with the phone camera. Chrome on Android has a built-in barcode reader (BarcodeDetector);
// on iPhone the same reader is loaded from a CDN the first time (a WebAssembly build of ZXing).
// Then the barcode is looked up: first in the family's own pantry, then in Open Food Facts and its sister databases
// for household goods and toiletries (free, open, with pictures; coverage of Singapore shelves is patchy, so when none
// knows a barcode the app asks which product it is and remembers it for next time).

const POLYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@2.3.1/dist/es/pure.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

let Detector = null;
async function detector() {
  if (!Detector) {
    if ('BarcodeDetector' in globalThis) {
      try {
        const ok = await globalThis.BarcodeDetector.getSupportedFormats();
        if (ok.includes('ean_13')) Detector = globalThis.BarcodeDetector;
      } catch { /* fall through to the polyfill */ }
    }
    if (!Detector) Detector = (await import(POLYFILL)).BarcodeDetector;
  }
  return new Detector({ formats: FORMATS });
}

// Live camera scan into <video>. Resolves with the barcode text, or null if stopped.
export function scanVideo(video) {
  let stop = false, stream = null;
  const done = (async () => {
    const d = await detector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    while (!stop) {
      try {
        const codes = await d.detect(video);
        if (codes.length) return codes[0].rawValue;
      } catch { /* frame not ready */ }
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  })().finally(() => { stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; });
  return { done, cancel() { stop = true; } };
}

// Scan many in a row: keeps the camera open and calls onCode(code) for each barcode it sees, once (the same barcode
// again counts only after `gap` ms off it, so holding one in view doesn't count it twice). cancel() ends it.
export function scanMany(video, onCode, { gap = 2500 } = {}) {
  let stop = false, stream = null, last = '', lastAt = 0;
  const done = (async () => {
    const d = await detector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    while (!stop) {
      let code = null;
      try { code = (await d.detect(video))[0]?.rawValue || null; } catch { /* frame not ready */ }
      const now = Date.now();
      if (code && (code !== last || now - lastAt > gap) && !stop) { onCode(code); }
      if (code) { last = code; lastAt = now; }
      await new Promise(r => setTimeout(r, 200));
    }
  })().finally(() => { stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; });
  return { done, cancel() { stop = true; } };
}

// Scan a still photo instead (works everywhere a file picker does).
export async function scanFile(file) {
  const d = await detector();
  const bmp = await createImageBitmap(file);
  const codes = await d.detect(bmp);
  return codes[0]?.rawValue || null;
}

// Product databases, asked in this order: food first, then household goods, then toiletries. All three are run by
// the same open project with the same API and send `access-control-allow-origin: *`. A household or toiletry hit
// also guesses a category and a place (the form only uses them if nobody has picked one).
export const DATABASES = [
  { source: 'food', host: 'world.openfoodfacts.org' },
  { source: 'products', host: 'world.openproductsfacts.org', category: 'Laundry & cleaning', location: 'Store room' },
  { source: 'beauty', host: 'world.openbeautyfacts.org', category: 'Toiletries', location: 'Bathroom' },
];
const FIELDS = 'product_name,product_name_en,brands,quantity,image_front_small_url,image_front_url';

// Product names in the open databases sometimes carry a shop's article number or the barcode itself
// ("17000466 Lays Lime Flavour Potato Chips"). Drop the barcode anywhere, and runs of 4+ digits at either end;
// numbers that are part of the name ("100PLUS", "3-in-1", "70 g") stay.
export function cleanName(name, code = '') {
  let s = String(name || '');
  if (code) s = s.split(String(code)).join(' ');
  s = s.replace(/^[\s\-–:#.,]*(\d{4,}[\s\-–:#.,]+)+/, '').replace(/([\s\-–:#.,]+\d{4,})+[\s\-–:#.,]*$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || String(name || '').trim();
}

// One database: { name, brand, size, image, source, category?, location? } or null (not known, an error, no signal
// or too slow). Never throws.
async function ask(db, code, { fetch: get, timeout, signal }) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  const timer = setTimeout(stop, timeout);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const r = await get(`https://${db.host}/api/v2/product/${code}.json?fields=${FIELDS}`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = cleanName(p.product_name_en || p.product_name, code);
    if (!name) return null;
    const out = { name, brand: String(p.brands || '').split(',')[0].trim(), size: String(p.quantity || '').trim(), image: p.image_front_small_url || p.image_front_url || '', source: db.source };
    if (db.category) Object.assign(out, { category: db.category, location: db.location });
    return out;
  } catch { return null; } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

// Look a barcode up in all three databases at once (each with its own time limit) and take the first that knows it,
// in the order above, so a food hit never waits for the others. Resolves null when none knows it, or offline.
export async function lookup(code, { fetch: get = globalThis.fetch, timeout = 6000 } = {}) {
  code = String(code || '').trim();
  if (!/^\d{6,14}$/.test(code) || typeof get !== 'function') return null;
  const ctl = new AbortController();
  const asks = DATABASES.map(db => ask(db, code, { fetch: get, timeout, signal: ctl.signal }));
  try {
    for (const a of asks) { const hit = await a; if (hit) return hit; }
    return null;
  } finally { ctl.abort(); }   // stop the slower ones once there's an answer
}
