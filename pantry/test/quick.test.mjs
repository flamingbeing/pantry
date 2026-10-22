// Unit tests for js/quick.js ("Say or type"): node pantry/test/quick.test.mjs
import assert from 'node:assert/strict';
import { parseQuick, findDate, splitItems } from '../js/quick.js';
import { CATALOGUE } from '../js/catalogue.js';

const T = '2026-10-16';
const opts = { today: T, catalogue: CATALOGUE };
const one = s => parseQuick(s, opts)[0];

// dates, in the ways people say them
for (const [said, date] of [
  ['expires 25 Oct', '2026-10-25'], ['best before 30/10', '2026-10-30'], ['use by 3/1', '2027-01-03'],
  ['by 25th of December', '2026-12-25'], ['Oct 25', '2026-10-25'], ['expires March 2028', '2028-03-31'],
  ['exp 02/2027', '2027-02-28'], ['2026-11-02', '2026-11-02'], ['in 3 days', '2026-10-19'], ['2 weeks', '2026-10-30'],
  ['next week', '2026-10-23'], ['tomorrow', '2026-10-17'], ['today', '2026-10-16'], ['25/12/27', '2027-12-25'],
  ['expired 10 Oct', '2026-10-10'],
]) assert.equal(findDate(said, T)?.date, date, said);
assert.equal(findDate('31/02', T), null, 'no 31 February');
assert.equal(findDate('3 tins of sardines', T), null, 'a count is not a date');

assert.deepEqual(splitItems('milk, eggs and bread\nrice; sugar plus salt'), ['milk', 'eggs', 'bread', 'rice', 'sugar', 'salt']);

// a whole sentence: quantity, place, date and the catalogue's details
const list = parseQuick('2 Meiji milk in the fridge expires 25 Oct, eggs and 3 tins of sardines', opts);
assert.equal(list.length, 3);
assert.deepEqual([list[0].qty, list[0].name, list[0].brand, list[0].location, list[0].expiry], [2, 'Fresh milk', 'Meiji', 'Fridge', '2026-10-25']);
assert.ok(list[0].match.cat);
assert.deepEqual([list[1].qty, list[1].name], [1, 'Eggs (10)']);
assert.deepEqual([list[2].qty, list[2].name, list[2].location], [3, 'Sardines in tomato sauce', 'Kitchen cabinet']);
assert.equal(one('two packets of bee hoon by next week').qty, 2);
assert.equal(one('Panadol medicine box expires March 2028').location, 'Medicine box');
// unknown things keep their own name; a place said overrides the usual one
assert.deepEqual([one('chicken thighs freezer in 3 months').name, one('chicken thighs freezer in 3 months').location], ['Chicken Thighs', 'Freezer']);
assert.equal(one('chicken thighs freezer in 3 months').match, null);
assert.equal(one('Milo in the fridge').location, 'Fridge');
// something already at home is matched first, so it adds stock instead of a second item
const mine = { id: 'm1', name: 'Kaya', brand: 'Glory', location: 'Fridge' };
assert.equal(parseQuick('kaya', { ...opts, items: [mine] })[0].match.mine, mine);
// nothing but filler: nothing to add
assert.deepEqual(parseQuick('and, the, ', opts), []);
console.log('pantry quick: ok');
