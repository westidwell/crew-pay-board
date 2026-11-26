# Crew Pay Board

**Piece-rate pay for small trade crews, on the crew lead's phone. One HTML file, works offline, no account.**

Crew Pay Board is for crews paid by the piece: installers, painters, flooring, fence, solar. You keep a rate card (task, unit, rate), log each job as it finishes (who did what, how many, plus any extras or back-charges), and the board keeps every person's running total for the week. At the end of the week you print a pay statement for each person or export the week as CSV for whoever cuts the checks.

Everything is saved in your browser on your device. Nothing is sent anywhere.

## Try it

It takes about two minutes.

1. Download this repo (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in any browser, on a computer or a phone.
3. A made-up fence crew (Ana, Bo and Teo) loads so you can poke around. Open the **Week** tab and tap a name to see how their pay adds up. Tap **Print pay statements** to see what a statement looks like.
4. When you're ready, tap **Start fresh**, add your tasks on **Rates** and your people on **Setup**, and log your first job on **Log job**.

### Put it on your phone as an app

To install it on a home screen and use it with no signal, the folder has to be served from a web address (a file opened straight from storage can't install). Any static host works. The simplest is GitHub Pages:

1. Fork this repo, then in your fork go to **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
2. A minute later, open `https://<your-github-name>.github.io/crew-pay-board/` on your phone.
3. iPhone: tap **Share**, then **Add to Home Screen**. Android: tap the menu, then **Install app**.

To try the installable version on your computer first:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000.

## What it does

- **Rate card.** Task name, unit (post, panel, ft, sq ft, gate, load...) and rate. Rates can have up to 4 decimals for per-foot and per-square-foot work.
- **Log a job in under a minute.** Date, job name or lot, then one line per task: pick the task, type the quantity, tap who did it. Pick two or three people and the line is split evenly between them.
- **Extras and back-charges.** Add money for one person (hand-dug posts, a second trip) or take it off (a re-hang, a broken panel). Each has a reason that shows on the statement.
- **Running week.** Each person's pieces, extras, back-charges and net pay so far, with every line behind it a tap away.
- **Printable statements.** One page per person with every job, quantity, rate and total, and a line to sign.
- **Monday or Sunday weeks.** Pick when your pay week starts.
- **CSV in and out.** Export the week line by line or as totals; import jobs from a spreadsheet.
- **Backup and restore.** One JSON file holds everything. Move it to a new phone or keep it as a record.
- **Copy a job.** Lots that look alike can be copied and changed instead of typed again.

## How it works

- `index.html` is the whole app: page, styles and code in one file. It's built from the files in `src/` by `scripts/build.js`.
- All the math lives in `src/engine.js`, which the page and the tests share. Money is kept as whole cents and quantity x rate is done in exact decimal math, so you never see `$0.30000000000000004`. Each line is rounded to the cent (half away from zero), and totals are the sum of those lines, so a statement always adds up on paper.
- When a line is split, the cents are shared out so they add back up exactly; a leftover penny goes to the first person picked.
- Each logged line keeps the rate it was logged with. Changing the rate card later never rewrites past pay.
- Data is saved in the browser's `localStorage`. `manifest.webmanifest` and `sw.js` let it install to a home screen and open with no signal.

### CSV format

One row per task line, extra, back-charge or job note. Rows with the same date and job name become one job. Download **CSV template** on the Setup tab for a filled-in example.

| column | what goes in it |
| --- | --- |
| `date` | `2026-03-02` (also reads `3/2/2026` and `3/2/26`) |
| `job` | job name or lot |
| `kind` | `work`, `extra`, `backcharge` or `note` (blank means `work`) |
| `person` | who; for a split line, names joined with `+`, like `Ana+Bo` |
| `task` | task name; if it's on your rate card the rate comes from there |
| `unit` | optional |
| `qty` | how many |
| `rate` | optional for tasks on your rate card |
| `amount` | dollars for extras and back-charges; on work rows it's only checked against qty x rate |
| `note` | reason for an extra or back-charge, or the job note |

Imports are careful with money: you see what will be added before anything changes, a job with any bad row is skipped whole (with the row number), new names are added to the crew, and a job already logged with the same date and name is skipped, so importing the same file twice never pays twice. Text that a spreadsheet would treat as a formula is defused on export.

## Free vs Pro

| | Free | Pro |
| --- | :---: | :---: |
| Rate card, job log, splits, extras and back-charges | Yes | Yes |
| Running week per person, printable statements | Yes | Yes |
| CSV import and export, backup and restore | Yes | Yes |
| Works offline, installs to the home screen | Yes | Yes |
| Crew sign-in: each person sees only their own pay on their own phone | | Yes |
| Office approval before pay is final | | Yes |
| Many crews, a rate card per customer | | Yes |
| Photo proof on each job | | Yes |
| Payroll export to payroll apps | | Yes |
| Pay history across years | | Yes |

Pro is $1/month and isn't open yet. See [PRO.md](PRO.md); star or watch this repo to hear when it opens. The Pro features show in the free app as locked buttons so you can see where they'll fit.

## Development

No dependencies to install. You need Node 20 or newer.

```sh
npm test        # all tests, offline
npm run build   # rebuild index.html and sw.js after changing src/
npm run check   # fails if index.html or sw.js is out of date
```

## Contributing

Bug fixes and new free features are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
