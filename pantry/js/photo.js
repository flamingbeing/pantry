// Photos: every picture is kept twice (owner, 16 Oct 2026):
//   - a tiny thumbnail (about 96px, a few KB) inside the item itself, for lists, rows, suggestions and Home;
//   - the photo (about 480px, 30-60 KB) in its own document, photos/<item id>, read only when that item is opened.
// Opening the app then downloads only the thumbnails, so a family with hundreds of photographed items stays well
// inside Firestore's free download allowance. The rules refuse anything bigger than the limits below.

export const THUMB = { max: 96, quality: 0.6, limit: 10 * 1024 };      // rules: thumb <= 12 KB
export const PHOTO = { max: 480, quality: 0.72, limit: 140 * 1024 };   // rules: photo <= 150 KB

// The size a picture is drawn at: the longer side at most `max`, never enlarged.
export function fitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w || 1, h || 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}
// The tries for one picture, best first: lower quality, then smaller, until it fits the limit.
export function steps({ max, quality }) {
  const out = [];
  for (const m of [max, Math.round(max * 0.75), Math.round(max * 0.5)]) {
    for (const q of [quality, Math.max(0.3, quality - 0.2), 0.3]) if (!out.some(s => s.max === m && s.q === q)) out.push({ max: m, q });
  }
  return out;
}
// Runs encode(step) through the steps and returns the first result under the limit (or the smallest one tried).
export function fit(encode, spec) {
  let best = null;
  for (const st of steps(spec)) {
    const url = encode(st);
    if (url.length <= spec.limit) return url;
    if (!best || url.length < best.length) best = url;
  }
  return best;
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function encoder(img) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  return ({ max, q }) => {
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, max);
    c.width = w; c.height = h;
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);   // transparent PNGs turn white, not black
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', q);
  };
}

// A camera picture (or any image file or blob) as { photo, thumb }, both small JPEG data URLs.
export async function pictures(file) {
  const url = URL.createObjectURL(file);
  try { return fromImage(await loadImage(url)); } finally { URL.revokeObjectURL(url); }
}
// The same from a picture already held as a data URL (an old-style item photo being moved).
export async function picturesFromData(dataUrl) {
  return fromImage(await loadImage(dataUrl), dataUrl);
}
function fromImage(img, keep = null) {
  const enc = encoder(img);
  const thumb = fit(enc, THUMB);
  // an old photo already small enough is kept exactly as it was
  const photo = keep && keep.length <= PHOTO.limit ? keep : fit(enc, PHOTO);
  return { photo, thumb };
}

// A product picture from a web address (Open Food Facts) as { photo, thumb }, so it shows offline too.
export async function fromUrl(src) {
  try {
    const r = await fetch(src, { mode: 'cors' });
    if (!r.ok) return null;
    return await pictures(await r.blob());
  } catch { return null; }
}
