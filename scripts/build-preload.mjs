import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outdir = path.resolve('dist-electron/electron');
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ['src/electron/preload.ts'],
  outfile: path.join(outdir, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
});
