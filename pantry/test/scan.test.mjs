// Unit tests for the barcode look-up chain in js/scan.js (a stubbed fetch, no network): node pantry/test/scan.test.mjs
import assert from 'node:assert/strict';
import { lookup, DATABASES, cleanName } from '../js/scan.js';

const CODE = '8888888000017';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const product = (name, f = {}) => json({ status: 1, product: { product_name: name, brands: 'Brand A, Brand B', quantity: '2 L', image_front_small_url: 'https://img.example/p.jpg', ...f } });
const miss = () => json({ status: 0, status_verbose: 'product not found' }, 404);
// a fetch that answers per host (a function or a value), and records what was asked
function stub(byHost) {
  const asked = [];
  const get = async (url, opts) => {
    const host = new URL(url).host;
    asked.push({ url, signal: opts?.signal });
    const a = byHost[host];
    return typeof a === 'function' ? a(opts) : a;
  };
  return { get, asked };
}
const [FOOD, PRODUCTS, BEAUTY] = DATABASES.map(d => d.host);
assert.deepEqual(DATABASES.map(d => d.source), ['food', 'products', 'beauty']);

// food hit: food wins even when the others know it too; no guessed category for food
{
  const { get, asked } = stub({ [FOOD]: product('Light soy sauce'), [PRODUCTS]: product('Wrong'), [BEAUTY]: product('Wrong') });
  const p = await lookup(CODE, { fetch: get });
  assert.deepEqual(p, { name: 'Light soy sauce', brand: 'Brand A', size: '2 L', image: 'https://img.example/p.jpg', source: 'food' });
  assert.equal(asked.length, 3, 'all three asked at once');
  assert.ok(asked.every(a => a.url.includes(`/api/v2/product/${CODE}.json?fields=`)), 'same API on each');
}

// food miss, products hit: household category and place guessed
{
  const { get } = stub({ [FOOD]: miss(), [PRODUCTS]: product('Laundry liquid', { product_name_en: 'Laundry liquid (EN)' }), [BEAUTY]: product('Shampoo') });
  const p = await lookup(CODE, { fetch: get });
  assert.equal(p.name, 'Laundry liquid (EN)', 'English name preferred');
  assert.equal(p.source, 'products');
  assert.equal(p.category, 'Laundry & cleaning');
  assert.equal(p.location, 'Store room');
}

// food and products miss (a 500 and an empty name), beauty hit: toiletries in the bathroom
{
  const { get } = stub({ [FOOD]: json({}, 500), [PRODUCTS]: product(''), [BEAUTY]: product('Toothpaste', { brands: '' }) });
  const p = await lookup(CODE, { fetch: get });
  assert.equal(p.name, 'Toothpaste');
  assert.equal(p.brand, '');
  assert.equal(p.category, 'Toiletries');
  assert.equal(p.location, 'Bathroom');
}

// all miss
{
  const { get } = stub({ [FOOD]: miss(), [PRODUCTS]: miss(), [BEAUTY]: json('not json', 500) });
  assert.equal(await lookup(CODE, { fetch: get }), null);
}

// network error (offline): no throw, null
{
  const get = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await lookup(CODE, { fetch: get }), null);
  const bad = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
  assert.equal(await lookup(CODE, { fetch: bad }), null);
}

// a slow database is given up on after its time limit; a later one still answers
{
  const hang = opts => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const { get } = stub({ [FOOD]: hang, [PRODUCTS]: product('Tissue'), [BEAUTY]: miss() });
  const t0 = Date.now();
  const p = await lookup(CODE, { fetch: get, timeout: 80 });
  assert.equal(p.name, 'Tissue');
  assert.ok(Date.now() - t0 < 2000, 'the time limit applies');
}

// once there's an answer the slower ones are stopped
{
  const { get, asked } = stub({ [FOOD]: product('Milo'), [PRODUCTS]: opts => new Promise(() => {}), [BEAUTY]: miss() });
  assert.equal((await lookup(CODE, { fetch: get, timeout: 200 })).name, 'Milo');
  assert.ok(asked.find(a => a.url.includes(PRODUCTS)).signal.aborted, 'the slower one is aborted');
}

// not a product barcode (a QR code's text, too short): nothing is asked
{
  const { get, asked } = stub({});
  assert.equal(await lookup('https://example.com', { fetch: get }), null);
  assert.equal(await lookup('123', { fetch: get }), null);
  assert.equal(asked.length, 0);
}


// names lose article numbers and the barcode, but keep numbers that belong to the name
assert.equal(cleanName('17000466 Lays Lime Flavour Potato Chips'), 'Lays Lime Flavour Potato Chips');
assert.equal(cleanName('Milo 3-in-1 Activ-Go 9556001234567', '9556001234567'), 'Milo 3-in-1 Activ-Go');
assert.equal(cleanName('100PLUS Original 325ml'), '100PLUS Original 325ml');
assert.equal(cleanName('Gardenia 400 g'), 'Gardenia 400 g');
assert.equal(cleanName('Kaya - 123456'), 'Kaya');
assert.equal(cleanName('12345678'), '12345678');

console.log('pantry scan look-up: ok');
