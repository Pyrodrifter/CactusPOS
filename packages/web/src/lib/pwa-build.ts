import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transformWithEsbuild, type Plugin } from 'vite';

/** Build-only worker; Vite's development server never installs or serves a worker. */
export function pwaBuild(): Plugin {
  let root = '';
  const publicAssets = [
    'manifest.webmanifest',
    'icons/icon-192.png', 'icons/icon-512.png',
    'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  ];
  return {
    name: 'cactuspos-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      if (config.base !== '/') throw new Error('CactusPOS PWA requires deployment at the origin root.');
    },
    async generateBundle(_options, bundle) {
      const source = await readFile(resolve(root, 'src/lib/pwa-worker.ts'), 'utf8');
      const hash = createHash('sha256').update(source);
      const built = Object.keys(bundle).filter((name) => name === 'index.html' || name.startsWith('assets/')).sort();
      if (!built.includes('index.html')) throw new Error('PWA build is missing index.html.');
      for (const name of built) {
        const output = bundle[name]!;
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source);
      }
      for (const name of publicAssets) {
        hash.update(name).update(await readFile(resolve(root, 'public', name)));
      }
      const config = {
        version: hash.digest('hex').slice(0, 20),
        shell: '/index.html',
        assets: [...built, ...publicAssets].map((name) => `/${name}`),
      };
      const result = await transformWithEsbuild(
        `${source}\ninstallPwaWorker(self, ${JSON.stringify(config)});`,
        'sw.ts', { loader: 'ts', format: 'iife', target: 'es2022', minify: true },
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: result.code });
    },
  };
}
