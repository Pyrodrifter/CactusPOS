// Builds the ready-made Windows package: a folder (and zip) that installs on a computer with nothing else on it.
// It contains the program, its libraries, the built screens and its own copy of Node.js, so the till computer
// needs no internet, no Node.js and no npm. The person installing unzips it and double-clicks "Install CactusPOS.bat".
//
//   node scripts/make-redist.mjs            -> dist/redist/CactusPOS/ and dist/redist/CactusPOS-<version>-win-x64.zip
//   node scripts/make-redist.mjs --no-zip   -> the folder only (faster, for testing)
//
// Run it on Windows x64 with the Node.js version you want to ship: the package gets a copy of the node.exe
// that runs this script. It needs internet once, for the program libraries and the Node.js licence text.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'dist', 'redist');
const stage = join(outDir, 'CactusPOS');
const zipWanted = !process.argv.includes('--no-zip');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const fail = (message) => { console.error(`\n${message}`); process.exit(1); };
const step = (message) => console.log(`\n== ${message}`);
function run(command, args, options = {}) {
  // npm is a .cmd on Windows, which Node only starts through a shell; the shell needs paths with spaces quoted.
  const shell = command.endsWith('.cmd');
  const quote = (text) => (shell && /\s/.test(text) ? `"${text}"` : text);
  const r = shell
    ? spawnSync([command, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true, ...options })
    : spawnSync(command, args, { stdio: 'inherit', ...options });
  if (r.error || r.status !== 0) fail(`${command} ${args.join(' ')} failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
}
const capture = (command, args) => {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

if (process.platform !== 'win32' || process.arch !== 'x64') fail('This package is for Windows x64; build it on such a computer.');
const npm = join(dirname(process.execPath), 'npm.cmd');
if (!existsSync(npm)) fail(`npm.cmd was not found next to ${process.execPath}.`);

step('Building the screens');
run(npm, ['run', 'build'], { cwd: root });

step(`Staging in ${relative(root, stage)}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const skip = (source) => /\.test\.(ts|mjs)$/.test(source) || /[\\/](testing|node_modules|private)$/.test(source);
const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true, filter: (source) => !skip(source) });
for (const file of ['package.json', 'package-lock.json', 'Install CactusPOS.bat']) copy(file);
copy('seed');
copy('ops/app');
copy('ops/windows');
copy('ops/install.md');
// The lock file names every workspace, so each needs its package.json even when only the server is installed.
for (const name of readdirSync(join(root, 'packages'))) copy(`packages/${name}/package.json`);
for (const name of ['shared', 'receipt', 'printer', 'books-bridge', 'server']) copy(`packages/${name}/src`);
copy('packages/web/dist');

step('Installing the program libraries (server only, no development tools)');
run(npm, ['ci', '--omit=dev', '--workspace', '@cactus/server', '--no-audit', '--no-fund'], { cwd: stage });

// npm links the workspace packages into node_modules with junctions, and a junction stores an absolute path:
// it would point at THIS computer's folder after unzipping elsewhere. Replace each with a real copy.
step('Replacing workspace links with real copies');
const scope = join(stage, 'node_modules', '@cactus');
for (const name of readdirSync(scope)) {
  const link = join(scope, name);
  if (!lstatSync(link).isSymbolicLink()) continue;
  rmSync(link, { recursive: true, force: true });
  if (name === 'server' || name === 'web') continue; // nothing imports these by name
  cpSync(join(stage, 'packages', name), link, { recursive: true });
  rmSync(join(stage, 'packages', name), { recursive: true, force: true });
  console.log(`  node_modules/@cactus/${name}`);
}
for (const required of ['node_modules/tsx/package.json', 'node_modules/fastify/package.json', 'node_modules/@cactus/shared/src/index.ts', 'packages/server/src/main.ts', 'packages/web/dist/index.html']) {
  if (!existsSync(join(stage, required))) fail(`The package is incomplete: ${required} is missing.`);
}

step(`Adding Node.js ${process.versions.node}`);
const runtime = join(stage, 'runtime', 'node');
mkdirSync(runtime, { recursive: true });
cpSync(process.execPath, join(runtime, 'node.exe'));
// Node.js may be redistributed under its licence when the licence text travels with it.
const licenceUrl = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
let licence;
try {
  const response = await fetch(licenceUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  licence = await response.text();
} catch (e) {
  fail(`Could not fetch the Node.js licence text from ${licenceUrl} (${e.message}).\nThe package must not be shared without it. Connect to the internet and run this again.`);
}
writeFileSync(join(runtime, 'LICENSE'), licence);
writeFileSync(join(runtime, 'README.txt'), [
  `This folder holds Node.js ${process.versions.node} for Windows x64, unchanged, from https://nodejs.org.`,
  'CactusPOS uses it to run its server, so the computer needs no separate Node.js installation.',
  'Node.js is distributed under the terms in the LICENSE file next to this note.',
  '',
].join('\r\n'));

const commit = capture('git', ['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = capture('git', ['status', '--porcelain']) ? ' (with uncommitted changes)' : '';
const built = new Date().toISOString().slice(0, 10);
writeFileSync(join(stage, 'VERSION.txt'), `CactusPOS ${pkg.version}\r\nBuilt ${built} from commit ${commit}${dirty}\r\nNode.js ${process.versions.node} (Windows x64)\r\n`);
writeFileSync(join(stage, 'READ ME FIRST.txt'), [
  'CactusPOS',
  '=========',
  '',
  'To install or update:',
  '  1. Put this whole folder somewhere it can stay, for example C:\\CactusPOS.',
  '  2. Double-click "Install CactusPOS.bat".',
  '     If Windows shows a security warning for a downloaded file, choose Run.',
  '     Windows asks once for permission to let phones and tablets reach the till: choose Yes.',
  '  3. Use the CactusPOS icon on the Desktop.',
  '',
  'Nothing else is needed: no internet and no other programs.',
  'Sales data is kept outside this folder, so replacing the folder with a newer version loses nothing.',
  'Kitchen tablet, updates, backups and problems: see ops\\install.md.',
  '',
].join('\r\n'));

// Windows scripts need Windows line endings, whatever the building computer checked out.
for (const file of ['Install CactusPOS.bat', ...readdirSync(join(stage, 'ops', 'windows')).filter((f) => f.endsWith('.ps1')).map((f) => join('ops', 'windows', f))]) {
  const path = join(stage, file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/g, '\r\n'));
}

const size = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
console.log(`\nFolder: ${stage}  (${Math.round(size(stage) / 1e6)} MB)`);

if (zipWanted) {
  step('Zipping');
  const zip = join(outDir, `CactusPOS-${pkg.version}-win-x64.zip`);
  // .NET's zip writer, which every Windows 10 and 11 has. (The tar.exe that ships with Windows crashed on this
  // folder, and "tar" from Git Bash cannot write zip files.) Paths travel in the environment, so they need no quoting.
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:CACTUS_ZIP_FROM, $env:CACTUS_ZIP_TO, 'Optimal', $true)"],
  { env: { ...process.env, CACTUS_ZIP_FROM: stage, CACTUS_ZIP_TO: zip } });
  console.log(`Zip:    ${zip}  (${Math.round(statSync(zip).size / 1e6)} MB)`);
}
