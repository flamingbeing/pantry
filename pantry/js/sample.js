// Made-up sample items (with a few months of history, so the consumption patterns show) for trying the app.
import { uid, ymd, addDays } from './logic.js';
import { DEFAULT_PLACES, placeId, cleanPlace } from './places.js';

// The demo's made-up family (?demo; never real people): Mum is "this phone", Dad made the last few days' changes, and
// Grandma has no name yet, so the family list shows her email.
export const DEMO_ME = 'mum@example.com';
export const DEMO_FAMILY = { id: 'demo', name: 'Our pantry', owner: DEMO_ME, members: [DEMO_ME, 'dad@example.com', 'grandma@example.com'] };
export const DEMO_NAMES = { 'mum@example.com': 'Mum', 'dad@example.com': 'Dad' };
export const demoBy = daysAgo => (daysAgo <= 3 ? 'Dad' : 'Mum');

// by: who the history is signed with, a name or a function of how many days ago (the demo's family).
// `removed`: also two items and a place already in Recently removed, and the places as documents (the demo shows that screen;
// the Settings button leaves them out and adds no places: the household's own list stays as it is).
export function sampleData(by = 'Sample', { removed = false } = {}) {
  const t = ymd();
  const now = Date.now();
  const ago = d => new Date(now - d * 86400000).toISOString();
  const items = [], events = [];
  const add = (f, batches, history = []) => {
    const it = { id: uid(), brand: '', size: '', lowAt: 0, barcode: '', openDays: null, createdAt: ago(200), sample: true, ...f, batches: batches.map(b => ({ id: uid(), openedAt: null, addedAt: t, ...b })) };
    items.push(it);
    for (const [type, d, qty = 1] of history) events.push({ id: uid(), itemId: it.id, name: it.name, type, qty, at: ago(d), by: typeof by === 'function' ? by(d) : by });
  };
  add({ name: 'Light soy sauce', brand: 'Kikkoman', size: '500 ml', category: 'Sauces & condiments', location: 'Kitchen cabinet', openDays: 90, lowAt: 1 },
    [{ qty: 1, expiry: addDays(t, 300), openedAt: addDays(t, -80) }, { qty: 1, expiry: addDays(t, 420) }],
    [['add', 170, 3], ['use', 160], ['use', 110], ['use', 80]]);
  add({ name: 'Premium oyster sauce', brand: 'Lee Kum Kee', size: '510 g', category: 'Sauces & condiments', location: 'Fridge', openDays: 90 },
    [{ qty: 1, expiry: addDays(t, 200), openedAt: addDays(t, -40) }], [['add', 60], ['open', 40]]);
  add({ name: 'Fresh milk', brand: 'Meiji', size: '2 L', category: 'Dairy & eggs', location: 'Fridge', openDays: 5, lowAt: 1 },
    [{ qty: 1, expiry: addDays(t, 3) }], [['add', 30, 4], ['use', 26], ['use', 21], ['use', 16], ['use', 12], ['add', 10, 3], ['use', 7], ['use', 3]]);
  add({ name: 'Wholemeal bread', brand: 'Gardenia', size: '400 g', category: 'Bread & bakery', location: 'Kitchen cabinet' },
    [{ qty: 1, expiry: addDays(t, -1) }], [['add', 6], ['discard', 0]]);
  add({ name: 'Kaya', brand: 'Glory', size: '250 g', category: 'Breakfast & spreads', location: 'Fridge', openDays: 14 },
    [{ qty: 1, expiry: addDays(t, 40), openedAt: addDays(t, -10) }], [['add', 12], ['open', 10]]);
  add({ name: 'Thai hom mali rice', brand: 'Royal Umbrella', size: '5 kg', category: 'Rice, noodles & grains', location: 'Kitchen cabinet', lowAt: 0 },
    [{ qty: 1, expiry: addDays(t, 250) }], [['add', 150, 2], ['use', 120], ['use', 75]]);
  add({ name: 'Sardines in tomato sauce', brand: 'Ayam Brand', size: '155 g', category: 'Canned & jarred', location: 'Kitchen cabinet', openDays: 2 },
    [{ qty: 4, expiry: addDays(t, 700) }], [['add', 90, 4]]);
  add({ name: 'Milo powder', brand: 'Nestlé', size: '1.5 kg', category: 'Drinks', location: 'Kitchen cabinet', openDays: 90 },
    [{ qty: 1, expiry: addDays(t, 9), openedAt: addDays(t, -50) }], [['add', 100, 2], ['use', 95], ['use', 50]]);
  add({ name: 'Laundry liquid', brand: 'Dynamo', size: '2.7 kg', category: 'Laundry & cleaning', location: 'Laundry', lowAt: 1 },
    [{ qty: 1, expiry: null }], [['add', 120, 3], ['use', 100], ['use', 55]]);
  add({ name: 'Bathroom tissue (10 rolls)', brand: 'Kleenex', size: '10 rolls', category: 'Kitchen & paper', location: 'Basement store' },
    [], [['add', 60, 2], ['use', 45], ['use', 15]]);
  add({ name: 'Paracetamol tablets', brand: 'Panadol', size: '20 tablets', category: 'Medicine & first aid', location: 'Medicine box' },
    [{ qty: 2, expiry: addDays(t, 25) }], [['add', 300, 2]]);
  add({ name: 'Eggs (10)', brand: 'Pasar', size: '10 eggs', category: 'Dairy & eggs', location: 'Fridge' },
    [{ qty: 1, expiry: addDays(t, 12) }], [['add', 20, 2], ['use', 14], ['add', 3]]);
  add({ name: 'Frozen dumplings', brand: 'CJ Bibigo', size: '1 kg', category: 'Frozen', location: 'Level 1 freezer' },
    [{ qty: 2, expiry: addDays(t, 120) }], [['add', 40, 3], ['use', 20]]);
  if (removed) {
    add({ name: 'Chilli sauce', brand: 'Maggi', size: '305 g', category: 'Sauces & condiments', location: 'Kitchen cabinet', removedAt: ago(27), removedBy: 'Dad' },
      [{ qty: 1, expiry: addDays(t, 200) }], [['add', 60]]);
    add({ name: 'Spring onions', brand: '', size: '1 bunch', category: 'Fresh produce', location: 'Fridge', removedAt: ago(2), removedBy: 'Mum' }, [], [['add', 9]]);
  }
  const places = [];
  if (removed) {
    DEFAULT_PLACES.forEach((n, i) => places.push({ id: placeId(n), name: cleanPlace(n), order: i + 1, updatedAt: ago(40) }));
    places.push({ id: placeId('Garage shelf'), name: 'Garage shelf', order: DEFAULT_PLACES.length + 1, updatedAt: ago(3), removedAt: ago(3), removedBy: 'Dad' });
  }
  return { items, events, places };
}
