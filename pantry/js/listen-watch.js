// The listener watchdog's decision (16 Oct 2026, "listener watchdog and stale-phone fix"). Pure: test/listen-watch.test.mjs runs it in
// Node; cloud.js keeps the facts and acts on the answer.
//
// WHY. The live harness (test/live-multidevice.mjs, scenario 9, seed 11, a full run, emulator dry run) found a phone showing an old
// value (eggs/e2 = 5) while the server AND the SDK's own cache held 4: the page last heard {"e2":5,"e1":4} while its own write was
// pending and then nothing for 30+ seconds; a fresh onSnapshot gave the right answer at once. A long-lived Firestore listener can
// stop delivering (after the network is switched off and on, or a phone coming back from the background with the stream dead
// but not yet noticed) without any error. WebKit's "reload while offline, then online" showed the same ("docFromCache error
// unavailable", correct only "after listening again"). The listener itself is fine to replace: a new one resumes from the server
// with a resume token, so only changed documents are read.
//
// The signs of a stuck listener, all known to the phone:
//  - 'cache': a listener has been showing the phone's own copy (fromCache) for CACHE_MS while the browser says it is online;
//  - 'flagged': a document is still flagged hasPendingWrites CACHE_MS after every one of this phone's writes was acknowledged (the
//    SDK clears that flag only when the listener hears the server's version: so it never clears on a stuck listener);
//  - 'quiet': at a moment the phone has just come back (the browser went online, the page became visible or was restored, the
//    person tapped Sync now) and no listener has heard the server for STALE_MS. A quiet household sends nothing for hours, so this
//    is only asked at those moments, never on a timer.
// At most one re-listen every THROTTLE_MS, and never while the browser says it is offline.

export const CACHE_MS = 8000;      // a listener fromCache this long while online
export const FLAG_MS = 6000;       // a document flagged pending this long after every write was acknowledged
export const STALE_MS = 10000;     // nothing heard from the server this long, at a moment the phone came back
export const THROTTLE_MS = 30000;  // at most one re-listen this often
export const ESCALATE_MS = 6000;   // still stuck this long after listening again: the connection itself is dead
export const CYCLE_THROTTLE_MS = 60000;   // at most one network restart this often

// WHAT THE HARNESS SHOWED ABOUT THE FIX. Replacing the listener is not always enough: in the failing run (seed 11) a phone that had been
// offline got its write acknowledged (the SDK said nothing pending, not fromCache) and still never heard the server's version for 30 s,
// through the app's listener, a second listener AND a listener made again: the connection the listeners share was dead. Only
// restarting it (the SDK's network switched off and on: streams, and their backoff, start afresh) brought the data. That is safe only
// when every write has been acknowledged (a write sent but not acknowledged is sent again by a restart, and an increment sent twice
// counts twice), which is also exactly when a document flagged pending can be called stuck. So: listen again first; if the sign is
// still there ESCALATE_MS later, and nothing is unacknowledged, restart the connection.

// s: { now, online, event (a moment the phone came back: online, visible, pageshow, Sync now), lastServerAt (the last snapshot that was not
//      fromCache, or 0), openedAt (when listening began), cacheSince (since when a listener has been fromCache, or 0), flaggedSince (since when
//      a document has been flagged with nothing in flight, or 0), lastRelisten, lastCycle (when each last happened, or 0),
//      quiet (every write this phone made has been acknowledged) }
// -> { relisten: boolean, cycle: boolean, why: 'cache' | 'flagged' | 'quiet' | '' }
export function decide(s) {
  const no = { relisten: false, cycle: false, why: '' };
  if (!s.online) return no;
  const stuck = s.cacheSince && s.now - s.cacheSince >= CACHE_MS ? 'cache' : s.flaggedSince && s.now - s.flaggedSince >= FLAG_MS ? 'flagged' : '';
  if (stuck && s.lastRelisten && s.now - s.lastRelisten >= ESCALATE_MS && s.quiet && !(s.lastCycle && s.now - s.lastCycle < CYCLE_THROTTLE_MS)) return { relisten: false, cycle: true, why: stuck };
  if (s.lastRelisten && s.now - s.lastRelisten < THROTTLE_MS) return no;
  if (stuck) return { relisten: true, cycle: false, why: stuck };
  if (s.event) {
    const heard = s.lastServerAt || s.openedAt || 0;
    if (heard && s.now - heard >= STALE_MS) return { relisten: true, cycle: false, why: 'quiet' };
  }
  return no;
}
