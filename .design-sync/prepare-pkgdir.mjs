// Builds node_modules/tixhub — the package directory the converter reads.
//
// package-build.mjs resolves the package as join(<node-modules>, cfg.pkg); npm
// never self-installs a private root package. A plain `ln -sfn ..` gets the
// build running but hands over the app's own package.json, which has no `types`
// field — and lib/dts.mjs derives its prop-extraction entry from it
// (`join(pkgDir, pkgJson.types ?? 'index.d.ts')`), so every component silently
// emits an empty `[key: string]: unknown` props stub.
//
// So this synthesizes the directory instead. Two kinds of content, and the
// difference matters:
//
//   * SYMLINKS for src/shared/dist/.design-sync. Config fields bounded to the
//     *workspace* root (tsconfig, extraEntries, extraFonts) resolve through
//     these fine.
//   * REAL FILES for the stylesheet and fonts. `cfgPath` bounds cssEntry to
//     PKG_DIR and compares REALPATHS, so a symlinked stylesheet resolves back
//     to the repo, lands outside the package, and is dropped with
//     `! cssEntry: … resolves outside the package — skipped`. The cards then
//     render in browser-default serif with no tokens at all. extractFonts
//     applies the same realpath rule to each url(), so the woff2s must be real
//     copies too.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgJson = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const dest = join(repo, 'node_modules', pkgJson.name);

const exists = (p) => { try { return !!lstatSync(p); } catch { return false; } };
if (exists(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

writeFileSync(join(dest, 'package.json'), JSON.stringify({
  name: pkgJson.name,
  version: pkgJson.version,
  type: pkgJson.type,
  types: 'dist/types/index.d.ts',
  dependencies: pkgJson.dependencies,
  peerDependencies: pkgJson.peerDependencies,
}, null, 2) + '\n');

for (const name of ['src', 'shared', 'dist', '.design-sync']) {
  if (existsSync(join(repo, name))) symlinkSync(join('..', '..', name), join(dest, name));
}

// ── the stylesheet, as a real file ──────────────────────────────────────────
// src/index.css is Tailwind SOURCE (`@import "tailwindcss"` + an `@theme`
// block), so it carries no utilities. The real stylesheet is Vite's compiled
// output — every utility the components use, all 185 tokens, and the three
// @font-face rules.
const assets = join(repo, 'dist', 'assets');
if (!existsSync(assets)) {
  console.error('✗ dist/assets missing — run `npm run build` first');
  process.exit(1);
}
const newest = readdirSync(assets).filter((f) => f.endsWith('.css'))
  .map((f) => ({ f, m: statSync(join(assets, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m)[0];
if (!newest) { console.error('✗ no .css in dist/assets'); process.exit(1); }

const fontsOut = join(dest, 'fonts');
mkdirSync(fontsOut, { recursive: true });
const srcFonts = join(repo, 'src', 'fonts');
let copied = 0;
let css = readFileSync(join(assets, newest.f), 'utf8');
// Vite emits absolute, hashed urls (`/assets/VNMSansStd-Regular-<hash>.woff2`).
// An absolute url resolves against the filesystem root and fails containment,
// so point each at the local copy beside the stylesheet.
css = css.replace(/url\(\/assets\/([^)'"]+?)\.(woff2?|ttf|otf)\)/g, (whole, stem, ext) => {
  const original = `${stem.replace(/-[A-Za-z0-9_-]{8}$/, '')}.${ext}`;
  if (!existsSync(join(srcFonts, original))) return whole;
  copyFileSync(join(srcFonts, original), join(fontsOut, original));
  copied++;
  return `url(./fonts/${original})`;
});
writeFileSync(join(dest, 'ds-styles.css'), css);

console.error(`✓ node_modules/${pkgJson.name}/ (types → dist/types/index.d.ts)`);
console.error(`✓ ds-styles.css from ${newest.f} (${Math.round(css.length / 1024)} KB, ${copied} font(s) copied)`);
