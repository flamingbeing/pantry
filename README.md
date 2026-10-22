# pantry

Pantry, the family's household inventory (what's at home, what's running low, what to buy), at
`pantry.flamingbeing.com`. The app is in [`pantry/`](pantry/README.md); hosting in [HOSTING.md](HOSTING.md);
rules for assistants in [AGENTS.md](AGENTS.md). Built on the family home design kit
(`https://design.flamingbeing.com/v1/`).

- `pantry/`: the app (static files, a service worker, Firebase for sign-in and sharing); `pantry/docs/` its design notes.
- `__/auth/`: Firebase's sign-in helper pages, served on the app's own address.
- `worker/`: the Cloudflare Worker that serves the files; `tools/`: checks, version stamp, proofreading.
