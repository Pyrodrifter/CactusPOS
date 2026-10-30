// Builds a signed sideload APK. Signing credentials stay outside the repository and must be backed up.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const project = join(root, 'ops/android');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA || '', 'Android/Sdk');
const privateDir = process.env.CACTUS_ANDROID_SIGNING_HOME || join(process.env.LOCALAPPDATA || homedir(), 'CactusPOSBuild/android');
const credentialFile = join(privateDir, 'signing.json');
const keyFile = join(privateDir, 'client-release.jks');
const fail = (message) => { console.error(message); process.exit(1); };
if (process.platform !== 'win32') fail('Use the Gradle wrapper directly on other platforms; this build helper targets Windows.');
if (!existsSync(join(sdk, 'platforms/android-36/android.jar'))) fail('Android SDK platform 36 is required. Set ANDROID_HOME to its SDK directory.');
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
let credentials;
if (existsSync(credentialFile)) credentials = JSON.parse(readFileSync(credentialFile, 'utf8'));
else {
  if (existsSync(keyFile)) fail(`Signing key already exists without its password file. Recover ${credentialFile}; do not replace the key.`);
  credentials = { password: randomBytes(32).toString('base64url') };
  writeFileSync(credentialFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
const env = { ...process.env, ANDROID_HOME: sdk, CACTUS_ANDROID_KEYSTORE: keyFile, CACTUS_ANDROID_STORE_PASSWORD: credentials.password };
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: project, env, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error || result.status !== 0) fail(`Android build step failed: ${command}${result.error ? ` (${result.error.message})` : ''}`);
};
if (!existsSync(keyFile)) {
  run('keytool.exe', ['-genkeypair', '-keystore', keyFile, '-storepass:env', 'CACTUS_ANDROID_STORE_PASSWORD', '-keypass:env', 'CACTUS_ANDROID_STORE_PASSWORD', '-alias', 'cactuspos', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=CactusPOS Android Client', '-noprompt']);
}
run('cmd.exe', ['/d', '/c', 'gradlew.bat', 'testDebugUnitTest', 'lintRelease', 'assembleRelease']);
const out = join(root, 'dist/android');
mkdirSync(out, { recursive: true });
const name = 'CactusPOS-Android-0.2.0.apk';
const file = join(out, name);
copyFileSync(join(project, 'app/build/outputs/apk/release/app-release.apk'), file);
const buildTools = readdirSync(join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const apkSigner = join(sdk, 'build-tools', buildTools, 'lib/apksigner.jar');
run('java.exe', ['-jar', apkSigner, 'verify', '--print-certs', file]);
const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
const source = createHash('sha256');
const fingerprint = (directory, prefix = '') => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['.gradle', 'build', 'local.properties'].includes(entry.name)) continue;
    const path = join(directory, entry.name), relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) fingerprint(path, `${relative}/`); else { source.update(relative); source.update(readFileSync(path)); }
  }
};
fingerprint(project);
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`);
writeFileSync(join(out, 'BUILD-INFO.json'), `${JSON.stringify({ app: 'CactusPOS Android LAN client', version: '0.2.0', signed: true, minAndroidApi: 26, targetAndroidApi: 36, builtAt: new Date().toISOString(), sourceSha256: source.digest('hex'), sha256, status: 'working-tree build; physical device acceptance required' }, null, 2)}\n`);
console.log(`\nAPK: ${file}\nSigning key retained in ${privateDir}. Back up this private folder for future app updates.`);
