# Contributing to F1 OpenViewer

Thanks for wanting to contribute. This project is maintained in spare time, so a bit of structure here helps keep things moving.

## Before you start

For anything more than a small fix (a new feature, a big refactor, changing how playback/DRM/license handling works), open an issue first and describe what you want to do. That way we can agree on the approach before you put time into it, and avoid a PR getting rejected after the fact.

Small fixes (typos, obvious bugs, small UI polish) can go straight to a PR.

## Questions

- Open a [GitHub Issue](../../issues) for anything related to the project (bugs, features, questions).
- For quicker back-and-forth, ping **@Ovetto** on Discord.

## Reporting bugs

Open an issue and include:

- What you did, what you expected, what actually happened.
- Your OS and app version.
- Console/log output if there's an error (the app logs to the terminal in dev mode, and DRM/license errors usually show a message in the UI).
- Whether it happens on a signed build (`release/win-unpacked`) or only in `npm run dev` (Widevine runs in a different mode in dev, see `docs/KNOWN_BUGS.md`).

## Setting up your environment

See `docs/SETUP.md` for the full setup (Node version, Widevine CDM, env vars). Quick version:

```
npm install          # npm 11/12: npm install --allow-git=all (Electron comes from castlabs on GitHub)
npm run dev
```

## Making a change

1. Fork the repo and create a branch off `main`.
2. Make your change.
3. Run `npm run check` (typecheck + tests, the same thing CI runs) and make sure it passes.
4. If you touched playback/DRM/UI, actually run the app (`npm run dev`) and check the flow you changed still works. Automated tests don't cover DRM playback.
5. Open a PR against `main` with a clear description of what changed and why.

## Coding conventions

CI runs typecheck, tests, a production build and a dependency audit; there is no linter/formatter yet, so:

- Match the style of the file you're editing.
- Keep comments to the "why", not the "what" — the code should already say what it does.
- Prefer small, focused PRs over one PR touching many unrelated things.
- New user-facing text goes through `t()` with keys in both languages (`src/i18n/translations.ts`); a test fails if EN and IT drift apart or a key is missing.
- Settings persisted from the renderer must be added to **both** `src/services/durableStorage.ts` and `electron/durableSettings.js` (a test enforces it).
- Never log tokens, signed URLs or JWT contents; use `redact` / `redactUrl` from `electron/util.js`.

## Code of conduct

Be respectful. This is a hobby project built around a paid F1 TV subscription and your own credentials — nothing here is about bypassing payment or DRM, so keep contributions aligned with that.
