// Pantry offline support, on the shared update module (app-update 0.2.0, core.anawj.com/update/): it installs every
// SHELL file or nothing, takes over at once and the page reloads once (js/app-update.js). The deploy stamps VERSION
// and MANIFEST (tools/stamp-versions.mjs: 'pantry-v1' becomes 'pantry-<date>-<hash>' from every file the app serves,
// MANIFEST a hash per SHELL file so an update fetches only changed files); never change them by hand. Change the v<N>
// only when this file's own logic changes.
//
// The app's own files, the design kit (design.flamingbeing.com/v1/), the sync engine and the update module are in
// SHELL; the Firebase SDK (gstatic), the barcode reader (jsDelivr) and other same-origin files are kept once fetched,
// so sharing and scanning keep working with no signal. Firebase's sign-in pages (/__/), sw.js itself and everything
// else (Firestore, Google, Open Food Facts) always go to the network.
const VERSION = 'pantry-v5';
const SHELL = [
  './',
  'pantry.css',
  'manifest.webmanifest',
  'config.js',
  'js/app.js',
  'js/logic.js',
  'js/catalogue.js',
  'js/store.js',
  'js/sample.js',
  'js/cloud.js',
  'js/scan.js',
  'js/guide.js',
  'js/photo.js',
  'js/quick.js',
  'js/tour.js',
  'js/places.js',
  'js/people.js',
  'js/merge.js',
  'js/sync.js',
  'js/select.js',
  'js/order.js',
  'js/drag.js',
  'js/bulk-items.js',
  'js/app-update.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'https://design.flamingbeing.com/v1/tokens.css',
  'https://design.flamingbeing.com/v1/app.css',
  'https://design.flamingbeing.com/v1/app.js',
  'https://design.flamingbeing.com/v1/icons.svg',
  // the sync engine (app-sync), one exact version: the app works offline only with it
  'https://core.anawj.com/sync/0.6.0/index.js',
  'https://core.anawj.com/sync/0.6.0/src/sync.js',
  'https://core.anawj.com/sync/0.6.0/src/writes.js',
  'https://core.anawj.com/sync/0.6.0/src/conflict.js',
  'https://core.anawj.com/sync/0.6.0/src/store.js',
  'https://core.anawj.com/sync/0.6.0/src/outbox.js',
  'https://core.anawj.com/sync/0.6.0/src/watchdog.js',
  'https://core.anawj.com/sync/0.6.0/src/persist.js',
  'https://core.anawj.com/sync/0.6.0/src/status.js',
  'https://core.anawj.com/sync/0.6.0/src/forget.js',
  'https://core.anawj.com/sync/0.6.0/src/firestore.js',
  'https://core.anawj.com/sync/0.6.0/src/registry.js',
  'https://core.anawj.com/sync/0.6.0/src/report.js',
  'https://core.anawj.com/sync/0.6.0/src/app.js',
  // the page half of the update module (register.js), one exact version: the page starts it offline too
  'https://core.anawj.com/update/0.2.0/register.js',
];

const MANIFEST = {};

importScripts('https://core.anawj.com/update/0.2.0/sw-core.js');
AppUpdate.init({
  app: 'pantry', version: VERSION, shell: SHELL, manifest: MANIFEST,
  // "Get the latest version" checks for signal by fetching sw.js: always the network
  never: [/\/sw\.js$/],
  runtime: [
    // the kit's /v1/ changes compatibly: answer from the cache, refresh in the background
    { name: 'kit', match: 'https://design.flamingbeing.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    // exact versions (the address carries it): never change
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'cdn', match: /^https:\/\/(cdn|fastly)\.jsdelivr\.net\/npm\/[^/]+@\d/, strategy: 'cache-first', max: 20 },
    // anything else of the app's own (a file not in SHELL) is kept after its first use
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|gif|ico|woff2?|ttf|webmanifest|txt|wasm)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
