// Updates through the shared update module (app-update 0.1.0, its page half register.js at one exact address): a new
// version installs in the background, takes over at once and the page reloads once; checked on every return to the
// app and every 3 h. Loaded with import() so a blocked core address never stops the app (it then runs as it is).
const CORE = 'https://core.anawj.com/update/0.1.0/register.js';
let loading = null;   // the module, once startUpdates has asked for it

export async function startUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || new URLSearchParams(location.search).has('nosw')) return null;
  try {
    loading = import(CORE);
    return await (await loading).register({ app: 'pantry', sw: 'sw.js' });
  } catch (e) { console.warn('Updates not started', e); return null; }
}

// '2026-10-24 (ab12cd34)' from the running service worker ('v4' unstamped; '' when none controls the page yet)
export async function versionText() {
  try { return loading ? String(await (await loading).versionLabel()).replace(/^pantry-/, '') : ''; } catch { return ''; }
}
