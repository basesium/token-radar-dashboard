// Token Radar entry (Node 22, standard library only).
//
// The program reads the sealed snapshot at /input/snapshot.json (or
// --input <file|dir>), scores every pre-token protocol with the radar-2
// model in lib/model.ts, and writes the ranked board to
// /output/board.json plus the dashboard's data beside the page as
// /output/data.js. It copies this repository's dashboard/ and
// screenshots/ into /output, then writes /output/dossier.json with
// buildDossier from vendor/makefun-board.ts.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes. Run it outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The directory this file lives in, so dashboard/ and screenshots/ are found. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Fail with a message on stderr and an exit code. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

/** The value after --name <value> in the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'token radar: usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>]\n' +
      'token radar: reads the sealed snapshot, scores the board with the radar-2 model,\n' +
      'token radar: and writes board.json, data.js, dashboard/, screenshots/ and dossier.json.\n',
  );
  process.exit(0);
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const input = arg('input', '/input');
const inputFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`, 1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
