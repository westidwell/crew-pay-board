# Contributing

Bug fixes and new free features are welcome. Small, focused pull requests are easiest to review.

Features listed in PRO.md are reserved for the Pro edition, so pull requests that add them will be closed with a pointer to PRO.md.

## How the code is laid out

- `src/engine.js`: all the pay math, week dates, CSV and backup logic. Pure functions, no DOM, no storage, no network. The page and the tests both load this file.
- `src/app.js`: the page (tabs, forms, printing, saving to localStorage).
- `src/pro.js`: stubs for the Pro features, plus `PRO_URL` and `PRO_PRICE`.
- `src/styles.css`, `src/template.html`, `src/sw.js`: look, page shell and the offline service worker.
- `index.html` and `sw.js` at the top are **built files**. Don't edit them by hand.

## Before you open a pull request

```sh
npm run build   # folds src/ into index.html and stamps sw.js
npm test        # runs every test, offline, no installs needed
```

CI runs the same tests and fails if `index.html` wasn't rebuilt.

## Ground rules

- No dependencies in the page. It must keep working as one file with no network.
- No analytics, tracking or calls to any server. Data stays on the user's device.
- Money stays in whole cents inside the engine. Add a test for any change to pay math.
- Sample data must be made up and obviously fictional.
- Plain words in the UI: the people using this are on a job site, on a phone.
