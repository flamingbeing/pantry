# Pantry: first-time help

The welcome, the guide screen, hints and the hands-on first steps. Index: [../NOTES.md](../NOTES.md).

- **Help for first-time users (16 Oct 2026, owner: "a walkthrough or guide for first time users"):** `js/guide.js`.
  The **welcome** is a kit sheet of three or four cards (what it's for; put it on your home screen, left out when it
  already runs installed; share with the family; add your first item, ending "Add my first item" or "Look around
  first"), with Next, Back, Skip, dots and an optional sideways swipe. It shows once per phone: the flag is
  `localStorage 'pantry:welcomed'` (through `prefs`, so wrapped in try/catch), set however the sheet closes. Never in
  `?demo` (or the emulator tests) unless `?welcome` is added; `?welcome` forces it anywhere. Someone already using the
  app on that phone (items, a family pantry or a name saved) never sees it: the flag is set quietly. The invite email's
  link ends `#/settings`; opening it gives a short version ending "Go to sign in" (Settings, Sign in focused). The
  **guide** is the screen `#/guide` ("How to use the pantry"), linked from Settings (Help: the guide and "Show the
  welcome again") and the empty Home. **Hints** stay quiet text: the empty shopping list says how things get there, the
  item explains the pace before two "Used 1"s, Settings signed out says why to sign in. Note: an iPhone home-screen app
  has its own storage, separate from Safari, so the welcome shows once more there (without the home-screen card).

- **16 Oct 2026, hands-on first steps** (owner: "the pantry needs a better walkthrough"; `js/tour.js`):
  - The welcome is two cards for someone new ("what it's for", then "fill it in a minute"); the home-screen and family
    cards became checklist steps. Invited people keep their short version ending at Sign in.
  - **Quick start** ("What do you have?"): about 26 everyday Singapore goods as chips grouped by where they're kept;
    tapped ones go in with their catalogue details and a rough best-before date (a typical shelf life), so an empty
    pantry is useful in under a minute. Things already in the pantry show "at home" and can't be picked twice.
  - **Getting started checklist** on Home: add what you have, say what you bought, mark one used, look at the
    shopping list, home screen, share with the family (only when sharing is set up). Each ticks itself from the data
    or a per-phone flag; "Show me" opens the right screen and rings the button (`pa-spot`, no animation with reduced
    motion). Only for people who start with this version (`pantry:tour` = 'on', set on the first welcome) or who turn
    it on in Settings → Help: families already using the pantry see nothing new. Hide puts it away for good.
