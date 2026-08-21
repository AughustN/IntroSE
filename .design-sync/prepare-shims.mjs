// Generates `.js` shims for the repo's TS-ESM-style alias imports.
//
// Files under src/components import shared types as `@shared/ads/types.js` — the
// TypeScript convention of writing the *emitted* .js extension while the file on
// disk is .ts. The converter's alias resolver (lib/bundle.mjs tsconfigPathsPlugin)
// only ever APPENDS extensions to the resolved stem, so `.../types.js` is looked
// up as `types.js`, `types.js.ts`, … and never as `types.ts`. Result: the bundle
// fails with `Could not resolve "@shared/ads/types.js"`.
//
// Rather than fork the converter, mirror shared/ into a shim tree whose files
// really are named `<name>.js` and just re-export the real source. The extra
// target in .design-sync/tsconfig.paths.json points the resolver here after the
// real path misses.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(repo, 'shared');
const shimRoot = join(repo, '.design-sync', '.cache', 'shims', 'shared');

if (!existsSync(sharedDir)) {
  console.error('✗ shared/ not found — nothing to shim');
  process.exit(1);
}

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

let n = 0;
for (const src of walk(sharedDir)) {
  if (!/\.tsx?$/.test(src) || /\.(test|spec)\.tsx?$/.test(src)) continue;
  const out = join(shimRoot, relative(sharedDir, src)).replace(/\.tsx?$/, '.js');
  mkdirSync(dirname(out), { recursive: true });
  // `export *` skips a default export, so re-export one explicitly when present.
  const hasDefault = /^\s*export\s+default\s/m.test(readFileSync(src, 'utf8'));
  const spec = JSON.stringify(src);
  writeFileSync(out, `export * from ${spec};\n` + (hasDefault ? `export { default } from ${spec};\n` : ''));
  n++;
}
console.error(`✓ ${n} shim(s) → .design-sync/.cache/shims/shared/`);
