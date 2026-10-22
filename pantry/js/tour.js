// Pantry: hands-on first steps for new users (the welcome only says what the app is for; this gets them doing it).
// 1. Quick start, "What do you usually have at home?": chips of everyday Singapore household goods grouped by where
//    they're kept. Tap the ones at home, then Add: each goes in with its catalogue details and a rough best-before
//    date (a typical shelf life, said to be a guess), so an empty pantry is useful in under a minute.
// 2. The "Getting started" checklist on Home: six small tasks that tick themselves off from what's actually in the
//    pantry (items, events, flags). "Show me" goes to the right screen and points at the button. Shown only to people
//    who started with this version (prefs 'tour' = 'on', set by the welcome) or who turn it on in Settings, so families
//    already using the pantry see nothing new. Hide puts it away; it never comes back on its own.
// Pure parts (STARTER, starterItems, tourTasks) take plain data, so test/logic.test.mjs can check them in Node.
import { CATALOGUE } from './catalogue.js';

// [catalogue name, catalogue brand, days to a typical best-before date (null: no date matters)]
export const STARTER = [
  ['Fridge', [
    ['Fresh milk', 'Meiji', 7], ['Eggs (10)', 'Pasar', 14], ['Yoghurt', 'Meiji', 10], ['Butter (salted)', 'SCS', 60],
    ['Cheese slices', 'Kraft', 30], ['Kaya', 'Glory', 30], ['Premium oyster sauce', 'Lee Kum Kee', 365],
    ['Tomato ketchup', 'Heinz', 365],
  ]],
  ['Kitchen cabinet', [
    ['Thai hom mali rice', 'Royal Umbrella', 365], ['Light soy sauce', 'Kikkoman', 540], ['Dark soy sauce', 'Tai Hua', 540],
    ['Cooking oil (blended)', 'Knife', 365], ['Fine sugar', 'SIS', null], ['Salt', 'FairPrice', null],
    ['White bread', 'Gardenia', 5], ['Milo powder', 'Nestlé', 365], ['Mee goreng instant noodles (5 pack)', 'Indomie', 240],
    ['Sardines in tomato sauce', 'Ayam Brand', 730], ['Tea bags', 'Lipton Yellow Label', 540], ['Dishwashing liquid', 'Mama Lemon', null],
  ]],
  ['Bathroom, laundry and store room', [
    ['Bathroom tissue (10 rolls)', 'Kleenex', null], ['Facial tissue (box)', 'Kleenex', null], ['Toothpaste', 'Colgate', 730],
    ['Shampoo', 'Pantene', 730], ['Laundry liquid', 'Dynamo', null], ['Garbage bags', 'FairPrice', null],
  ]],
];

const find = (name, brand) => CATALOGUE.find(c => c.name === name && c.brand === brand) || CATALOGUE.find(c => c.name === name);
// The starter chips as { key, group, cat, days }; a line whose product isn't in the catalogue is left out.
export function starterChoices() {
  const out = [];
  STARTER.forEach(([group, lines]) => lines.forEach(([name, brand, days], i) => {
    const cat = find(name, brand);
    if (cat) out.push({ key: `${group}:${i}`, group, cat, days });
  }));
  return out;
}

// The checklist. state: { items, events, flags: { said, shopped, installSeen, familyDone }, installed, sharing }
// sharing: 'none' (no Firebase config: the family step is left out), 'out' (signed out or no household) or 'in'.
export function tourTasks({ items = [], events = [], flags = {}, installed = false, sharing = 'none' } = {}) {
  const tasks = [
    { id: 'stock', title: 'Add what you have', sub: 'Tap what’s at home, or + to add one', done: items.length >= 3 },
    { id: 'say', title: 'Say what you bought', sub: 'The microphone at the top of Home', done: !!flags.said },
    { id: 'use', title: 'Mark one as used', sub: 'Open an item and tap Used 1', done: events.some(e => e.type === 'use') },
    { id: 'shop', title: 'Look at the shopping list', sub: 'It fills itself with what’s running low', done: !!flags.shopped },
    { id: 'install', title: 'Put it on your home screen', sub: 'It then opens like an app, even without signal', done: installed || !!flags.installSeen },
  ];
  if (sharing !== 'none') tasks.push({ id: 'family', title: 'Share it with the family', sub: 'Sign in and add their email', done: sharing === 'in' || !!flags.familyDone });
  return tasks;
}
