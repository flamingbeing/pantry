// Waits until both local emulators answer (the config's webServer waits for Auth; Firestore can come up a little later).
export default async function () {
  if (process.env.PW_NO_EMULATOR) return;
  const hosts = [process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085', process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'];
  const until = Date.now() + 120_000;
  for (const h of hosts) {
    for (;;) {
      try { if ((await fetch(`http://${h}/`)).status < 500) break; } catch { /* not up yet */ }
      if (Date.now() > until) throw new Error(`emulator at ${h} did not start`);
      await new Promise(r => setTimeout(r, 250));
    }
  }
}
