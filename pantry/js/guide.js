// Pantry: help for first-time users. Two parts, kept here so app.js stays small:
// 1. The welcome: a short, skippable sheet, shown once per phone. New users get two cards (what it's for, then "fill
//    it in a minute", which opens the quick start in tour.js); the home screen and family sharing are steps in the
//    Home checklist instead (tour.js). Shown once per phone (localStorage 'pantry:welcomed'). Never in ?demo unless ?welcome is added;
//    never for someone who already uses the app (items, a family pantry or a name on this phone). Someone opening an
//    invite (the link ends #/settings) gets a shorter version that ends at Sign in. Skip, back, Escape or dragging
//    the sheet down all close it, and it never comes back on its own ("Show the welcome again" in Settings).
// 2. The guide screen (#/guide, "How to use the pantry"): short grouped sections, linked from Settings and from the
//    empty Home screen.
// Everything is shared-kit parts (js/ui.js on app-ui); the few own styles are pa-w* and pa-dots in pantry.css.
import { sheet, closeSheet, icon, esc, announce } from './ui.js';
import { prefs } from './store.js';

const FLAG = 'welcomed';   // prefs key: localStorage 'pantry:welcomed'
export const welcomed = () => !!prefs.get(FLAG, false);
export const markWelcomed = () => prefs.set(FLAG, true);
// Running from the home screen already (no need for the home-screen card).
export function installed() {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
}

const row = (iconName, title, sub = '', trail = '') => `<li><div class="ui-row"><span class="pa-row-icon">${icon(iconName)}</span>
  <span class="ui-row-main"><span class="pa-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span>${trail}</div></li>`;
const plainRow = (title, sub = '', trail = '') => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span>${trail ? `<span class="pa-row-trail">${trail}</span>` : ''}</div></li>`;
const list = rows => `<ul class="ui-list">${rows.join('')}</ul>`;

// ---------- the welcome ----------

const FOR = list([
  row('box', 'What’s at home', 'In the fridge, freezer and cupboards'),
  row('clock', 'What to use first', 'Things near their date come to the top'),
  row('cart', 'What to buy', 'Running low goes on the shopping list'),
  row('mic', 'Quick to fill in', 'Tap what you have, say it, or scan the barcode'),
]);
const CARDS = {
  intro: {
    icon: 'home', title: 'Welcome to the pantry',
    text: 'One list of what’s at home, for the whole family.',
    body: FOR,
  },
  invited: {
    icon: 'users', title: 'Welcome to the family pantry',
    text: 'Someone in the family added you. Once you sign in, you see the same items and shopping list as them.',
    body: FOR,
  },
  install: {
    icon: 'download', title: 'Put it on your home screen',
    text: 'It then opens like an app, full screen, and works without signal.',
    body: list([
      row('share', 'iPhone', 'In Safari, tap Share, then Add to Home Screen.'),
      row('plus', 'Android', 'In Chrome, tap the menu (three dots), then Add to home screen or Install app.'),
    ]),
  },
  family: {
    icon: 'users', title: 'Share it with the family',
    text: 'Everyone then sees the same pantry and shopping list. You can skip this and use it on this phone alone.',
    body: list([
      row('user', 'Starting it', 'Settings, then Continue with Google (or Use email instead) and Start our family pantry. Add each person’s email.'),
      row('mail', 'Already added by someone?', 'Sign in with the email they added: Google, an emailed link or a password. Your family pantry appears.'),
      row('mail', 'Signing in by email', 'Settings, Use email instead: we email you a link, or you use a password. A new password account needs its emailed link tapped once, then I’ve verified.'),
      row('users', 'In two family pantries?', 'Settings shows a card, and Home a note. Tap Merge them, keep the one with the most people, and everything moves into it. Only whoever started the others can do it.'),
      row('info', 'Who can see it', 'Only the people added. No one else.'),
    ]),
  },
  first: {
    icon: 'plus', title: 'Fill it in a minute',
    text: 'Tap the everyday things you have at home and they go straight in, with a rough best-before date you can change later.',
    body: list([
      row('check', 'Tap what you have', 'Rice, eggs, milk, soy sauce, tissue… grouped by where they’re kept.'),
      row('mic', 'Or say it', 'The microphone on Home: “2 Meiji milk in the fridge expires 25 Oct”.'),
      row('list', 'Then a short checklist', 'Home shows a few first steps, each with a Show me button.'),
    ]),
  },
  signin: {
    icon: 'user', title: 'Sign in to join',
    text: 'Sign in once and the family pantry appears on this phone.',
    body: list([
      row('user', 'Tap Continue with Google', 'On the Settings screen, under Family sharing. No Google? Tap Use email instead: an emailed link, or a password.'),
      row('mail', 'Use the email they added', 'The address the invite was sent to. Another account sees an empty pantry.'),
    ]),
  },
};

// Which cards: invited people get a short version ending at Sign in; someone signed in already skips sharing.
export function welcomeCards({ invited = false, signedIn = false, isInstalled = installed() } = {}) {
  const ids = invited ? ['invited', 'install', 'signin'] : ['intro', 'first'];
  return ids.filter(id => id !== 'install' || !isInstalled);
}

// Open the welcome sheet. onDone(choice) runs after it closes: 'start' (Pick what you have), 'signin' (Go to sign in) or
// undefined (skipped or Look around first). The flag is set however it closes (unless save is false: the demo).
export function openWelcome({ invited = false, signedIn = false, save = true, onDone } = {}) {
  const ids = welcomeCards({ invited, signedIn });
  let at = 0;
  const s = sheet({
    title: 'Getting started', closeLabel: 'Skip', grey: true, detent: 'large',
    lead: `<button type="button" class="pa-btn pa-btn--plain pa-btn--compact" data-pa-w="prev" hidden>Back</button>`,
    body: `<div class="pa-welcome" id="pa-welcome"></div>`,
    footer: `<div class="pa-dots" aria-hidden="true">${ids.map(() => '<span class="pa-dot"></span>').join('')}</div><div class="pa-btn-stack pa-wbtns" id="pa-wbtns"></div>`,
    onClose: v => { if (save) markWelcomed(); onDone?.(v); },
  });
  const el = s.el;
  el.classList.add('pa-wsheet');
  const card = el.querySelector('#pa-welcome'), btns = el.querySelector('#pa-wbtns');
  const prev = el.querySelector('[data-pa-w="prev"]'), skip = el.querySelector('.ui-sheet-head [data-pa-close]');
  const draw = (focus = false) => {
    const id = ids[at], c = CARDS[id], last = at === ids.length - 1;
    card.dataset.card = id;
    card.innerHTML = `<div class="pa-wtop"><span class="pa-wicon">${icon(c.icon)}</span>
      <h3 class="pa-wtitle" tabindex="-1"><span class="pa-sr">Step ${at + 1} of ${ids.length}: </span>${esc(c.title)}</h3>
      <p class="pa-wtext">${esc(c.text)}</p></div>${c.body}`;
    el.querySelectorAll('.pa-dot').forEach((d, i) => d.classList.toggle('is-current', i === at));
    prev.hidden = at === 0;
    skip.textContent = last ? 'Close' : 'Skip';
    btns.innerHTML = !last
      ? `<button type="button" class="pa-btn ui-primary pa-btn--block" data-pa-w="next">Next</button>`
      : invited
        ? `<button type="button" class="pa-btn ui-primary pa-btn--block" data-pa-w="signin">Go to sign in</button>
           <button type="button" class="pa-btn pa-btn--plain pa-btn--block" data-pa-w="done">Look around first</button>`
        : `<button type="button" class="pa-btn ui-primary pa-btn--block" data-pa-w="start">Pick what you have</button>
           <button type="button" class="pa-btn pa-btn--plain pa-btn--block" data-pa-w="done">Look around first</button>`;
    el.querySelector('.ui-sheet-body').scrollTop = 0;
    if (focus) { el.querySelector('.pa-wtitle').focus({ preventScroll: true }); }
  };
  const step = d => {
    const n = Math.min(ids.length - 1, Math.max(0, at + d));
    if (n === at) return;
    at = n; draw(true);
    announce(`Step ${at + 1} of ${ids.length}`);
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pa-w]'); if (!b) return;
    const a = b.dataset.paW;
    if (a === 'next') step(1);
    else if (a === 'prev') step(-1);
    else closeSheet(el, a === 'done' ? undefined : a);
  });
  // swipe sideways between cards (optional; the buttons do the same)
  let x0 = null, y0 = 0;
  card.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
  card.addEventListener('pointerup', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  card.addEventListener('pointercancel', () => { x0 = null; });
  draw();
  return s;
}

// ---------- the guide screen ----------

const badge = (text, tone = '') => `<span class="pa-badge${tone ? ' pa-badge--' + tone : ''}">${esc(text)}</span>`;
function section(id, title, rows, footer = '') {
  return `<section class="pa-section" aria-labelledby="h-g-${id}"><h2 class="pa-section-header" id="h-g-${id}"><span>${esc(title)}</span></h2>${list(rows)}${footer ? `<p class="pa-section-footer">${footer}</p>` : ''}</section>`;
}

export function viewGuide() {
  return `<h1 class="ui-large-title">How to use the pantry</h1>
    <p class="pa-large-sub">Everything it does, in a few words each.</p>
    ${section('adding', 'Adding things', [
      row('search', 'Search the list', 'Tap + and type a name, like soy sauce or Milo. Picking a common Singapore product fills in the brand, size and where it’s kept.'),
      row('mic', 'Say or type a list', 'Tap the microphone on Home, or Say or type a list on Add. Say “2 Meiji milk in the fridge expires 25 Oct and 3 tins of sardines”, check the list it makes, then Add.'),
      row('barcode', 'Scan a barcode', 'Tap Scan barcode and point the camera at it. Food, household goods and toiletries are looked up in open product lists. If no one knows the barcode yet, pick the product or type its name once, and scanning finds it next time.'),
      row('camera', 'Add a photo', 'So everyone knows which one it is.'),
      row('home', 'Places', 'Where things are kept, like Fridge or Level 1 freezer. In Settings, then Places: rename them, change their order, say which are fridges and freezers, or add your own. The family shares one list.'),
      row('plus', 'How many', 'How many you have now. Tap + or − to change it.'),
      row('calendar', 'Best before', 'Picking a product guesses it from how long it usually keeps (“About 1 week”). Change it to the date on the pack, or tap 1 month… for a rough one.'),
      row('bowl', 'Leftovers', 'On Home or Add: type what it is, and it goes in the fridge to use within 3 days. It never goes on the shopping list.'),
      row('list', 'Plenty, low, out', 'For rice, oil or loose vegetables, choose “Plenty, low, out” instead of counting. Low or Out puts it on the shopping list.'),
      row('clock', 'Keeps once opened', 'How many days it lasts after opening, like 5 for milk. Leave it empty for things that don’t go off.'),
    ])}
    ${section('daily', 'Every day', [
      row('check', 'Used 1', 'Tap on the item when one is finished. It takes one out of stock.'),
      row('box', 'Open', 'Tap when you open one. Its countdown starts (only for things with “keeps once opened”).'),
      row('trash', 'Bin 1', 'Tap when one is thrown away. If it was past its date, it counts as expired. Home counts what gets wasted each month.'),
      row('refresh', 'Undo', 'Tapped the wrong thing? Tap Undo in the message at the bottom.'),
      row('trash', 'Recently removed', 'Deleted something by mistake? Settings, Recently removed keeps deleted items, shopping list lines and places for 30 days. Tap Restore.'),
      row('cart', 'Bought more', 'On the item, add what you bought and its date.'),
      row('snowflake', 'Freeze and Thaw', 'Freeze keeps it about a year (bread a month); Thaw gives 3 days. Both ask how many, and which freezer or fridge when you have more than one. Moving food into a freezer freezes it, out of one thaws it. Frozen by mistake? Not frozen puts the packaging date back.'),
      row('barcode', 'Scan many', 'On Home: choose Bought, Used up or Add to list, then scan one barcode after another. Done saves them all, with one Undo.'),
      row('check', 'Select several', 'On Items, tap Select (or press and hold a row), tick items, then Move to…, Shopping list or Delete. One Undo for the lot.'),
      row('edit', 'Bulk edit', 'On Items, tap Bulk edit: pick items, choose what to change (place, category, how it is counted, best-before, shopping list, delete), then Review. One Undo for the lot.'),
      row('list', 'Your own order', 'On Items, choose Category, then My order. Drag an item by its grip (the dots) up or down inside its category, or tap the grip for Move up and Move down.'),
      row('home', 'Move by dragging', 'Drag an item by its grip onto a place (a heading under Sort by Place, or a place at the top) to move it. While selecting, the grip of a ticked item moves them all.'),
      row('home', 'Group by place', 'On Items, choose Place under Sort by: a heading for each place, with how many. Tap a heading to fold it.'),
    ])}
    ${section('soon', 'Use soon and expired', [
      plainRow('Past its date', 'Use it today or throw it away.', badge('Expired', 'bad')),
      plainRow('Within a week', 'Use these first. Home lists everything due in the next two weeks.', badge('2 days', 'warn')),
      plainRow('Within a month', 'Fine for now.', badge('3 weeks')),
      plainRow('Since you last looked', 'Home shows what the rest of the family bought, used or binned since you last opened the pantry.', ''),
      plainRow('Send to WhatsApp', 'Under Use soon, send the “use this week” list to the family chat.', ''),
    ], 'Opened items count down from the day they were opened, or to the printed date if that comes first.')}
    ${section('shop', 'Shopping list', [
      row('cart', 'It fills itself', 'Items land here when none are left, when they’re down to their “on the list when down to” number, or when they’ll run out within a week at your usual pace.'),
      row('plus', 'Add anything', 'Type it at the top of the list, say it with the microphone, or tap a Buy again chip.'),
      row('list', 'By aisle', 'The list is grouped like the shop: sauces, rice, dairy and so on.'),
      row('check', 'Tick, then Put away', 'Tick things as they go in the trolley. At home, Put away lists them all with their place and date; one tap adds them to the pantry.'),
      row('external', 'Buy online', 'Each item links to FairPrice, Sheng Siong, Cold Storage and Shopee search.'),
      row('share', 'Share the list', 'Tap Share at the top to send it in a message, or Going shopping now to tell the family on WhatsApp.'),
    ])}
    ${section('pace', 'How fast we use it', [
      row('clock', 'Two “Used 1”s', 'After the second, the item shows how long one lasts and when it will run out, and puts it on the list in time.'),
    ])}
    ${section('family', 'Family sharing', [
      row('user', 'Start it', 'One person: Settings, Continue with Google (or Use email instead), then Start our family pantry.'),
      row('users', 'Add the family', 'Type each person’s email and tap Add, then tap them to email the link.'),
      row('edit', 'Names', 'Tap someone, yourself included, to give them a name, like Mum. Everyone sees it instead of the email, in history and on the list.'),
      row('mail', 'When you’re invited', 'Open the link, then Settings, Continue with Google or Use email instead, with the email that was added.'),
      row('info', 'Who can see it', 'Only the people added. Whoever started it can stop sharing with anyone else.'),
    ])}
    ${section('phone', 'Phone tips', [
      row('download', 'On your home screen', 'iPhone: in Safari, Share, then Add to Home Screen. Android: in Chrome, the menu, then Add to home screen.'),
      row('cloud', 'No signal', 'It still works. Changes reach the family when you’re back online.'),
      row('refresh', 'Not sure it reached the family?', 'Settings, Sync now: it sends anything waiting, lists each change and says if everything is saved.'),
      row('refresh', 'Looks out of date?', 'At the bottom of Settings, tap Get the latest version. Your items are kept.'),
    ])}
    <ul class="ui-list pa-gagain"><li><button type="button" class="ui-row pa-row--action pa-row--center" data-act="welcome"><span class="ui-row-main"><span class="pa-row-title">Show the welcome again</span></span></button></li></ul>`;
}
