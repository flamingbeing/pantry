# Notes

Lasting rules and lessons for the repo as a whole; the app's own notes and how to test are in `pantry/NOTES.md`.

- **Design kit by URL (22 Oct 2026):** browsers refuse SVG `<use>` across addresses, so the kit's `app.js` puts its
  icon sprite into the page when it is loaded from another address; static icons write `<use href="#i-<name>"/>`.
  The service worker keeps the kit cache-first like the CDN files. Browser tests load the live kit.
