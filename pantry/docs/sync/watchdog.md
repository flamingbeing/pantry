# Pantry sync safety: The listener watchdog

Dated design record, moved out of [../sync-safety.md](../sync-safety.md) (the index). Pantry notes: [../../NOTES.md](../../NOTES.md).

- **16 Oct 2026, the listener watchdog (commit 5 of the combined PR; evidence from the live harness, `test/live-multidevice.mjs`, scenario 9,
  seed 11, a full run, with `--shadow`, on the emulator dry run `test/run-live-dry.sh`):** before the fix that run failed about half the time
  (found 2 of 4 clean runs): phone A showed an old value (eggs/e2 = 5) while the server and the SDK's own cache had 4. **Root cause, as far
  as it could be taken:** the page last heard `{e2: 5}` while its own write was pending, then nothing. The SDK reported every write
  acknowledged and not `fromCache`, the document stayed flagged `hasPendingWrites` (the SDK clears that flag only when the listen stream
  delivers the server's version), and the app's listener, the harness's shadow listeners AND a listener made again all stayed behind for
  30+ s, until the harness's own server read and a new listener (35 s) woke the connection. So it is not the app dropping a snapshot
  (docChanges is now read with metadata changes and each document compared with what was last delivered: that is kept as a safety net,
  but it was not the cause) and not only a dead listener: **the connection the listeners share was dead after an offline spell** (the
  browser's network was cut and restored; the SDK did not notice). WebKit's "reload while offline, then online" failure ("docFromCache
  error unavailable", right only "after listening again") fits. The owner's long "Waiting for signal (1 change)" on wifi with a VPN
  very likely was this and the false positive of commit 1.
  - **What the app does now** (`js/listen-watch.js`, pure, `test/listen-watch.test.mjs`; the facts are kept in `cloud.js`): a
    timer (every 3 s) and the moments a phone comes back (the browser's `online`, the page becoming visible, `pageshow`, Sync now)
    look for three signs, never while the browser says it is offline: a listener showing only the phone's own copy for 8 s ("cache"); a
    document still flagged pending 6 s after every write of this phone was acknowledged ("flagged"); and, only at a coming-back moment,
    no snapshot from the server for 10 s ("quiet": a quiet household sends nothing for hours, so age alone is never a sign). Then: (1) the
    listeners are replaced (old unsubscribers closed first, never two sets; the new first snapshot only reports documents that
    changed or are gone, a resume token keeps the read to what changed; at most one every 30 s); (2) if the sign is still there 6 s
    later and nothing is unacknowledged, the SDK's network is switched off and on (`disableNetwork`, 300 ms, `enableNetwork`; at
    most one a minute). The restart is allowed only when every write is acknowledged, because a restart sends an unacknowledged write
    again and an increment sent twice counts twice; and that is exactly when a flagged document can be called stuck. Result: seed 11
    now passes (5 of 5 full runs, the stale phone catching up in about 20 s instead of never inside the harness's 30 s).
  - **The chip** uses the same freshness: `syncState` ignores "showing its own copy" when the server was heard from in the last 10 s
    (`recent`), and `pending` already counts only unacknowledged writes (commit 1), so a stale listener with nothing to send says Saved.
  - **Test:** `sync.e2e.mjs` "the listener watchdog" (through `test/proxy.mjs`, whose `dropListen` throws away what the server says on the
    listen stream, a dead stream nothing reports): the phone does not hear a change; at a coming-back moment it listens again and
    catches up inside 15 s, once (a second nudge inside 30 s does nothing); and with a write acknowledged on a dead stream it acts by
    itself (no event) and catches up.
