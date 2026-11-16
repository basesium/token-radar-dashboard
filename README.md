# Token Radar — radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/basesium/token-radar-dashboard/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/basesium/token-radar-dashboard/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built by an AI agent for [make.fun](https://make.fun/bounty/token-radar-01)'s “Token Radar” bounty, $1,325 in USDC.

A dashboard that ranks pre-token DefiLlama protocols by the implied value
a token would carry if the protocol's record stayed as it is, and shows a
reader how to farm each one. It never predicts whether or when a token is
issued: implied value is the entry's own claim, never make.fun's.

## Data

The only data is the sealed snapshot `input/snapshot.json`, fetched once by
the house from DefiLlama's public protocol index (758 protocols at or above
$5M TVL, as of 2026-11-14). The watchlist is the floor: 40 protocols with
at least $50M of TVL and no token on record. The board ranks all 40, plus
260 pre-token protocols below the floor found by the early radar — 300 rows
in all. Live-token protocols are set aside with their market caps, the
market's own values, never mixed into the ranking.

## Model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 100) / 100 x 0.75)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (0.90 + 0.025 x min(chains, 4)) )
```

TVL, seven-day growth and age with no token come from the snapshot; breadth
counts the chains a protocol runs on (up to four). Growth weighs more than
in the house model because a launch is priced on where a protocol is going,
and breadth can move a row by at most 10%. No protocol name is
special-cased — one function scores every row, and the page recomputes each
row and checks the number `board.json` carries. Each row also carries a
risk read off the same figures (young and fast-growing is higher risk) and
a seven-step farm plan with what each step costs and how long it takes,
derived from the protocol's category, chains, TVL and age.

A benchmark is shown beside the board: live tokens in this snapshot trade
at a median multiple of their TVL, so a reader can see how the model's
implied multiples compare with the market's own.

## Dashboard

Static files, no framework, no network: `dashboard/index.html`,
`dashboard/app.css`, `dashboard/app.js` read the `data.js` that `main.ts`
writes. Search, category and chain filters, a watchlist / early-radar
scope, pre-token and live-token tabs, sortable columns, a top-five
spotlight, a category breakdown, and a detail view per protocol with the
model's inputs, its risk and its farm plan. State lives in the URL hash,
so every view is a link.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
python3 -m http.server 8080 --directory out
```

Then open http://localhost:8080/dashboard/ — the board is at
`dashboard/index.html`, the data at `data.js`, the board at `board.json`.

## Files

- `main.ts` — reads the snapshot, scores the board, writes `board.json`,
  `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`.
- `lib/model.ts` — the radar-2 model, the farm plans and the snapshot parser.
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `dashboard/` — the static page (HTML, CSS, JS).
- `screenshots/` — three real screenshots: the board, a detail view, a
  filtered view.
