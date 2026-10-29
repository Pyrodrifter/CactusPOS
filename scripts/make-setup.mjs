// Builds everything a release needs, in dist/redist:
//   CactusPOS-Setup-<version>.exe         the setup program: one file to double-click (ops/windows/setup.iss)
//   CactusPOS-<version>-win-x64.zip       the same program as a folder, for whoever prefers that
//   CactusPOS-Manual-English.pdf, CactusPOS-Handleiding-Nederlands.pdf   the user manual
//   SHA256SUMS.txt                        to check a download
//
//   node scripts/make-setup.mjs           everything (runs scripts/make-redist.mjs first)
//   node scripts/make-setup.mjs --reuse   only compile the setup again from the folder already in dist/redist/CactusPOS
//
// Needs Inno Setup 6 on this computer (free, https://jrsoftware.org/isinfo.php):
//   winget install --id JRSoftware.InnoSetup -e
// Set ISCC to the full path of ISCC.exe when it is installed somewhere unusual.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'dist', 'redist');
const stage = join(outDir, 'CactusPOS');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const fail = (message) => { console.error(`\n${message}`); process.exit(1); };
const step = (message) => console.log(`\n== ${message}`);

if (process.platform !== 'win32') fail('The setup program is built on Windows.');
const iscc = [
  process.env.ISCC,
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env.ProgramFiles ?? '', 'Inno Setup 6', 'ISCC.exe'),
].find((path) => path && existsSync(path));
if (!iscc) fail('Inno Setup 6 was not found. Install it with:\n  winget install --id JRSoftware.InnoSetup -e\nor set ISCC to the full path of ISCC.exe.');

if (!process.argv.includes('--reuse')) {
  const made = spawnSync(process.execPath, [join(root, 'scripts', 'make-redist.mjs')], { cwd: root, stdio: 'inherit' });
  if (made.status !== 0) fail('Building the package folder failed.');
}
if (!existsSync(join(stage, 'runtime', 'node', 'node.exe'))) fail(`There is no package folder in ${stage}. Run this without --reuse.`);
if (JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).version !== pkg.version) fail('The staged package is a different version. Run this without --reuse.');

// Test the bits we ship, with their bundled runtime, after relocating them away from the checkout.
step('Checking the packaged till, concurrent sales, restart and backup recovery');
const verified = spawnSync(process.execPath, [join(root, 'scripts', 'release-smoke.mjs'), '--program', stage], { cwd: root, stdio: 'inherit' });
if (verified.status !== 0) fail('The packaged till failed its release drill. No new setup was compiled.');
copyFileSync(join(root, '.local', 'release-smoke-package.json'), join(outDir, 'RELEASE-VERIFICATION.json'));
copyFileSync(join(root, 'ops', 'deployment.md'), join(outDir, 'DEPLOYMENT-CHECKLIST.md'));

// Windows refuses paths over 260 characters in many programs. The setup installs under
// C:\Users\<name>\AppData\Local\Programs\CactusPOS; leave room for a long user name.
const longest = (dir, base = '') => readdirSync(dir, { withFileTypes: true }).reduce((best, entry) => {
  const path = `${base}\\${entry.name}`;
  const found = entry.isDirectory() ? longest(join(dir, entry.name), path) : path;
  return found.length > best.length ? found : best;
}, '');
const deepest = longest(stage);
console.log(`\nLongest path inside the package: ${deepest.length} characters`);
if (deepest.length > 180) fail(`A file in the package has a very long path (${deepest.length} characters), which can fail to install:\n${deepest}`);

step(`Compiling the setup program with ${iscc}`);
const setup = join(outDir, `CactusPOS-Setup-${pkg.version}.exe`);
rmSync(setup, { force: true });
const compiled = spawnSync(iscc, ['/Qp', `/DAppVersion=${pkg.version}`, `/DStage=${stage}`, `/DOutDir=${outDir}`, join(root, 'ops', 'windows', 'setup.iss')], { cwd: root, stdio: 'inherit' });
if (compiled.status !== 0 || !existsSync(setup)) fail('Inno Setup could not compile ops/windows/setup.iss. The messages above say why.');

step('Checking a fresh install, update over a running till and uninstall');
const installed = spawnSync(process.execPath, [join(root, 'scripts', 'installer-smoke.mjs'), setup], { cwd: root, stdio: 'inherit' });
if (installed.status !== 0) fail('The setup failed its install/update/uninstall drill. Do not distribute it.');
copyFileSync(join(root, '.local', 'installer-smoke.json'), join(outDir, 'INSTALLER-VERIFICATION.json'));

// The manual also goes beside the setup, so it can be attached to the release on its own.
for (const file of readdirSync(join(stage, 'Manual'))) copyFileSync(join(stage, 'Manual', file), join(outDir, file));

step('Files for the release');
const files = readdirSync(outDir).filter((name) => /\.(exe|zip|pdf)$/.test(name) || ['RELEASE-VERIFICATION.json', 'INSTALLER-VERIFICATION.json', 'DEPLOYMENT-CHECKLIST.md'].includes(name)).sort();
const sums = files.map((name) => `${createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex')}  ${name}`);
writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
for (const name of files) console.log(`  ${name}  (${(statSync(join(outDir, name)).size / 1e6).toFixed(1)} MB)`);
console.log(`\n${sums.join('\n')}\n\nIn ${outDir}`);
