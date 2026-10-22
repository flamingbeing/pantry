// Unit tests for js/tour.js (first steps): node pantry/test/tour.test.mjs
import assert from 'node:assert/strict';
import { STARTER, starterChoices, tourTasks } from '../js/tour.js';

// every quick-start line is a real catalogue product, with its usual place
const c = starterChoices();
assert.equal(c.length, STARTER.reduce((n, [, l]) => n + l.length, 0), 'no starter line is missing from the catalogue');
assert.ok(c.every(x => x.cat.location && x.cat.category), 'each has a place and a category');
assert.equal(new Set(c.map(x => x.key)).size, c.length, 'keys are unique');
assert.equal(c.find(x => x.cat.name === 'Fresh milk').days, 7);

// the checklist ticks itself from the data
const ids = t => t.filter(x => x.done).map(x => x.id);
assert.deepEqual(ids(tourTasks({})), []);
assert.equal(tourTasks({}).length, 5, 'no family step without sharing set up');
assert.equal(tourTasks({ sharing: 'out' }).length, 6);
const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
assert.deepEqual(ids(tourTasks({ items, events: [{ type: 'use' }], flags: { said: true, shopped: true }, installed: true, sharing: 'in' })),
  ['stock', 'say', 'use', 'shop', 'install', 'family']);
assert.deepEqual(ids(tourTasks({ items: items.slice(0, 2), events: [{ type: 'add' }], flags: { installSeen: true } })), ['install'],
  'two items is not enough yet; buying is not using');
console.log('pantry tour: ok');
