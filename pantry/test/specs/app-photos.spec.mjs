// Photos: a tiny thumbnail on the item, the photo itself in photos/<id> read only when the item opens (this phone's own
// pantry): an old-style item with the whole photo inside moves by itself, adding with a camera picture, lists use the
// thumbnail, a fresh start loads only thumbnails, Remove photo, delete + Undo, the backup holds the photos, and the sizes.
// Run: npx playwright test app-photos
import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { open, go, hash, toast, undo, noSideways, shot, itemById, WELCOMED } from './app-helpers.mjs';

// a photo-like test picture (colours, shapes, text, a little grain), or pure noise for the worst case
const picture = (page, w, h, noise = false) => page.evaluate(async ([w, h, noise]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#c0392b'); gr.addColorStop(0.5, '#f1c40f'); gr.addColorStop(1, '#2c3e50');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${rnd() * 360},60%,${30 + rnd() * 40}%)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * w / 6, 0, 7); g.fill(); }
  g.font = `bold ${Math.round(h / 8)}px sans-serif`; g.fillStyle = '#fff'; g.fillText('SOY SAUCE 500 ml', w * 0.1, h * 0.55);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = noise ? 0 : (rnd() - 0.5) * 24; for (let k = 0; k < 3; k++) d[i + k] = noise ? rnd() * 255 : d[i + k] + n; }
  g.putImageData(img, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return [...new Uint8Array(await b.arrayBuffer())];
}, [w, h, noise]).then(a => Buffer.from(a));
// read or write one document of the phone's own database
const idb = (page, key, val) => page.evaluate(([k, v]) => new Promise((res, rej) => {
  const r = indexedDB.open('pantry');
  r.onsuccess = () => {
    const t = r.result.transaction('docs', v === undefined ? 'readonly' : 'readwrite'), st = t.objectStore('docs');
    const q = v === undefined ? st.get(k) : st.put(v, k);
    t.oncomplete = () => { r.result.close(); res(v === undefined ? q.result ?? null : null); };
    t.onerror = () => rej(t.error);
  };
}), [key, val]);
const heroIs = (page, data) => page.waitForFunction(d => document.querySelector('#pa-hero')?.src === d, data);

async function phoneWithPhotos(phone, name) {
  return open(phone, name, undefined, { init: WELCOMED });
}
// an item saved before 16 Oct 2026, with the whole photo inside it, moves to a thumbnail + photos/<id> by itself
async function oldItem(page) {
  const legacy = await page.evaluate(async () => {
    const { pictures } = await import('/pantry/js/photo.js');
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
    g.fillStyle = '#2a7'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(100, 100, 300, 200);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return (await pictures(b)).photo;
  });
  await idb(page, 'items/legacy1', { id: 'legacy1', name: 'Old photo item', brand: '', size: '', category: 'Other', location: 'Kitchen cabinet', openDays: null, lowAt: 0, barcode: '', photo: legacy, batches: [], createdAt: '2026-10-01T00:00:00Z' });
  await page.reload();
  await expect(page.locator('.ha-large-title')).toBeVisible();
  await page.waitForFunction(() => { const i = window.__pantry?.S?.items.get('legacy1'); return i && !('photo' in i) && i.hasPhoto; });
  // the moved photo has been written too
  await expect.poll(() => idb(page, 'photos/legacy1')).not.toBeNull();
  return { legacy, migrated: await idb(page, 'items/legacy1') };
}
// a new item with a camera picture; leaves the phone on its screen
async function addWithPhoto(page, jpeg, name = 'Photo test sauce') {
  await go(page, '#/add');
  await page.fill('#pa-form [name="name"]', name);
  await page.setInputFiles('#pa-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.locator('.pa-photo img')).toBeVisible();
  await expect(page.locator('[data-act="photo-del"]'), 'the form offers Remove photo').toBeVisible();
  await page.click('#pa-save');
  await expect.poll(() => hash(page)).toMatch(/^#\/item\//);
  const id = hash(page).split('/')[2];
  await expect.poll(() => idb(page, 'photos/' + id), 'the photo is saved on its own').not.toBeNull();
  return id;
}

test('an old-style item with its whole photo inside moves to a thumbnail + photos/<id> by itself', async ({ phone }) => {
  const page = await phoneWithPhotos(phone, 'migrate');
  const { legacy, migrated } = await oldItem(page);
  const legacyDoc = await idb(page, 'photos/legacy1');
  expect(migrated && !('photo' in migrated) && migrated.hasPhoto === true && migrated.thumb.startsWith('data:image/jpeg') && migrated.thumb.length <= 12288, 'old photo moved: the saved item keeps only a thumbnail').toBe(true);
  expect(legacyDoc?.data === legacy, 'and its photo, unchanged, is in photos/<id>').toBe(true);
  expect(migrated.name === 'Old photo item' && migrated.updatedBy === undefined, 'nothing else about the item changed').toBe(true);
  // the backup holds the photos (a removed item’s too, until it is purged)
  await go(page, '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(backup.photos?.some(p => p.id === 'legacy1' && p.data === legacy), 'the backup includes the photos').toBe(true);
  expect(backup.items.find(i => i.id === 'legacy1')?.thumb === migrated.thumb, 'and the items their thumbnails').toBe(true);
});

test('add an item with a camera picture: a thumbnail on the item, the photo on its own, lists use the thumbnail', async ({ phone, axe }) => {
  const page = await phoneWithPhotos(phone, 'add photo');
  const { migrated } = await oldItem(page);
  const jpeg = await picture(page, 1600, 1200);
  const id = await addWithPhoto(page, jpeg);
  const added = await itemById(page, id), doc = await idb(page, 'photos/' + id);
  expect(added.hasPhoto === true && !('photo' in added) && added.thumb.startsWith('data:image/jpeg'), 'the item holds a thumbnail, not the photo').toBe(true);
  expect(doc && doc.id === id && doc.data.startsWith('data:image/jpeg') && doc.data.length > added.thumb.length * 3, 'the photo is saved on its own').toBe(true);
  const dims = await page.evaluate(async ([a, b]) => {
    const size = src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; });
    return [await size(a), await size(b)];
  }, [added.thumb, doc.data]);
  expect(dims, 'thumbnail 96x72, photo 480x360').toEqual([[96, 72], [480, 360]]);
  await heroIs(page, doc.data);   // the item screen shows the photo
  await axe(page, 'item with a photo');
  await noSideways(page, 'item with a photo');
  await shot(page, '30-item-photo');
  // lists use the thumbnail
  await go(page, '#/items');
  await expect(page.locator('#pa-items-list a.ha-row', { hasText: 'Photo test sauce' }).locator('img.ha-row-thumb'), 'the list shows the thumbnail').toHaveAttribute('src', added.thumb);
  await expect(page.locator('#pa-items-list a.ha-row', { hasText: 'Old photo item' }).locator('img.ha-row-thumb'), 'and the moved item its thumbnail').toHaveAttribute('src', migrated.thumb);
  await go(page, '#/');
  expect(await page.evaluate(() => [...document.querySelectorAll('img')].every(i => !i.src.startsWith('data:') || i.src.length <= 12288)), 'Home has no full photos').toBe(true);

  // a fresh start reads the photo only when the item opens
  await page.reload();
  await expect(page.locator('.ha-large-title')).toBeVisible();
  await page.waitForFunction(() => !!window.__pantry?.S);
  expect(await page.evaluate(() => window.__pantry.S.pics.size), 'nothing but thumbnails loaded at start').toBe(0);
  await go(page, '#/item/' + id);
  await heroIs(page, doc.data);
  expect(await page.evaluate(id => window.__pantry.S.pics.get(id)?.data?.length, id), 'opening the item fetched its photo').toBe(doc.data.length);
});

test('Remove photo clears both; a new photo, then delete the item: its photo goes too, and Undo brings both back', async ({ phone }) => {
  const page = await phoneWithPhotos(phone, 'remove photo');
  const jpeg = await picture(page, 1600, 1200);
  const id = await addWithPhoto(page, jpeg);
  const added = await itemById(page, id);
  await page.click('[data-act="edit"]');
  await expect(page.locator('.pa-photo img'), 'edit shows the thumbnail').toHaveAttribute('src', added.thumb);
  await page.click('[data-act="photo-del"]');
  await page.click('#pa-save');
  await expect.poll(async () => { const b = await itemById(page, id); return !b.thumb && !b.hasPhoto && !('photo' in b); }, 'Remove photo clears the thumbnail').toBe(true);
  await expect.poll(() => idb(page, 'photos/' + id), 'and deletes the photo').toBeNull();
  await expect(page.locator('#pa-hero'), 'the item shows no picture').toHaveCount(0);

  // a new photo again, then delete the item: its photo goes too, and Undo brings both back
  await page.click('[data-act="edit"]');
  await page.setInputFiles('#pa-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.locator('.pa-photo img')).toBeVisible();
  await page.click('#pa-save');
  await expect.poll(async () => (await idb(page, 'photos/' + id))?.data?.startsWith('data:image/jpeg'), 'a new photo is saved').toBe(true);
  const again = await idb(page, 'photos/' + id);
  await page.click('[data-act="delete"]');
  await expect.poll(async () => (await idb(page, 'items/' + id))?.removedAt && (await idb(page, 'photos/' + id))?.data === again.data, 'deleting the item hides it and keeps its photo (until it is purged after 30 days)').toBeTruthy();
  await undo(page);
  await expect.poll(async () => !(await idb(page, 'items/' + id))?.removedAt && (await idb(page, 'photos/' + id))?.data === again.data && (await idb(page, 'items/' + id))?.hasPhoto, 'Undo brings the item back, photo and all').toBeTruthy();
});

test('every picture fits the rules: a photo-like camera picture and pure noise (the worst case)', async ({ phone }) => {
  const page = await phoneWithPhotos(phone, 'sizes');
  const jpeg = await picture(page, 1600, 1200), noise = await picture(page, 1600, 1200, true);
  const sizes = await page.evaluate(async bufs => {
    const { pictures } = await import('/pantry/js/photo.js');
    const out = [];
    for (const b of bufs) { const p = await pictures(new Blob([new Uint8Array(b)], { type: 'image/jpeg' })); out.push([p.thumb.length, p.photo.length]); }
    return out;
  }, [[...jpeg], [...noise]]);
  expect(sizes.every(([t, p]) => t <= 12288 && p <= 153600), 'every picture fits the rules').toBe(true);
  test.info().annotations.push({ type: 'photo sizes (data URL bytes)', description: `camera-like 1600x1200 JPEG (${jpeg.length} B) -> thumb ${sizes[0][0]}, photo ${sizes[0][1]}; noise (${noise.length} B) -> thumb ${sizes[1][0]}, photo ${sizes[1][1]}` });
});
