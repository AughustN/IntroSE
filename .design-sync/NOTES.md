# design-sync notes

## Repo shape
- `tixhub` is a Vite **application**, not a published library: `private: true`, no
  `main`/`module`/`exports`, and `dist/` is an app build (index.html + assets), not a library dist.
  The converter runs in **synth-entry mode**, reading `src/` directly — `.d.ts` contracts are
  weaker than a real library build would give.
- No Storybook anywhere (no `.storybook/`, no `*.stories.*`) → `shape = "package"`.
- 110 components under `src/components` across account, admin, booking, common, organizer,
  reviews, seatmap, wallet, plus 28 root-level.
- `@/*` and `@shared/*` aliases resolve via `tsconfig.web.json` (no `baseUrl`; paths are relative
  to the tsconfig's own directory under `moduleResolution: "bundler"`).

## Styling: why cssEntry points at a generated file
- `src/index.css` is **Tailwind v4 source**, not usable CSS — it opens with `@import "tailwindcss"`
  and declares tokens in an `@theme` block. Pointing `cssEntry` at it would ship a stylesheet with
  no utility classes, and every component here is styled with utilities.
- The real stylesheet is Vite's compiled output, `dist/assets/index-<hash>.css` (~108KB): all used
  utilities, every `--color-*` token, and the three `@font-face` rules.
- Two things stop that file being a usable `cssEntry` directly: the filename hash changes every
  build, and its font `url()`s are absolute (`/assets/VNMSansStd-Regular-<hash>.woff2`). An
  absolute url resolves against the filesystem root, fails `lib/css.mjs`'s containment check, and
  the fonts silently never reach the bundle's `fonts/`.
- Hence **`.design-sync/prepare-css.mjs`** (committed): copies the newest compiled CSS to the fixed
  path `.design-sync/.cache/tailwind-compiled.css` and rewrites each font url to
  `../../src/fonts/<unhashed>.woff2` — relative, because `lib/css.mjs` resolves an explicit
  `cssEntry`'s urls against *its own dirname*.
- So `buildCmd` is `npm run build && node .design-sync/prepare-css.mjs`. **Always run both** — a
  bare `npm run build` leaves the converter reading a stale compiled stylesheet.

## Palette naming (read by role, not by name)
Token names are pre-redesign and deliberately kept that way in `src/index.css`:
`xanh-pho`=surface, `beige-kem`=ink/foreground, `burgundy`=tomato, `cam-dat`=peach,
`la-co`=periwinkle. The `:root` blocks re-declare the `@theme` custom properties so switching
`data-theme` repaints at runtime.

## Environment
- npm + `package-lock.json`. The existing `node_modules` was kept rather than `npm ci`-ing: peer
  Claude sessions share this checkout and `npm ci` wipes node_modules under them.
- Lockfile listed `cloudinary` as missing; installed with `npm install --no-save cloudinary@^2.5.1`
  so `package-lock.json` stays untouched. Server-only dep, irrelevant to the UI bundle.
- Playwright 1.62.1 + chromium build 1234, installed into `.ds-sync/node_modules`.
  **On macOS the browser cache is `~/Library/Caches/ms-playwright`**, not `~/.cache/ms-playwright`
  — checking the Linux path makes a healthy install look missing.

## Repo fix made during the sync (2026-08-20)
- `src/components/seatmap/BlockInspector.tsx` had a stray `</p>` + `)}` at lines 321-322, left over
  from an edit — `npm run build` failed with "Unexpected closing p tag does not match opening div".
  The preceding block (312-320) was already complete; the two lines were deleted. This was
  pre-existing uncommitted breakage, not caused by the sync.
  Backup of the original: scratchpad `BlockInspector.tsx.bak`.

## Scope decision (user, 2026-08-20)
- Sync **all 110** components (each ships functional: bundle + `.d.ts` + `.prompt.md`).
- Rich **authored previews** prioritized for **seatmap (32)** and **organizer (15)**.

## Upload status
- 2026-08-20: `DesignSync(create_project)` returned `HTTP 500 internal server error` on four
  attempts across two names ("TixHub Design System", "TixHub"). `list_projects` succeeded and
  returned an empty list, so auth/connectivity were fine — the create endpoint itself was erroring.
  No project created, so **no `projectId` pin** exists. Run built locally into `ds-bundle/`;
  the next run creates the project and uploads.

## `node_modules/tixhub` is a SYNTHESIZED package dir, not a self-symlink
`package-build.mjs` resolves the package as `join(<node-modules>, cfg.pkg)` and reads its
`package.json` there; npm never self-installs a private root package, so the first run died with
`ENOENT … node_modules/tixhub/package.json`.

`ln -sfn .. node_modules/tixhub` gets the build running, but it hands the converter **the app's own
package.json**, which has no `types` field — and `lib/dts.mjs` computes its extraction entry as
`join(pkgDir, pkgJson.types ?? 'index.d.ts')`, i.e. a nonexistent `<repo>/index.d.ts`. Extraction is
`project.getSourceFile(entry).getExportedDeclarations()`, so a missing entry means **every**
component gets an empty `[key: string]: unknown` props stub, silently.

`.design-sync/prepare-pkgdir.mjs` (committed, part of `buildCmd`) therefore builds
`node_modules/tixhub/` as a real directory: a generated `package.json` whose `types` points at
`dist/types/index.d.ts`, plus relative symlinks to `src`, `shared`, `dist`, `.design-sync`. All of it
sits inside gitignored `node_modules`, so **the app's own package.json is never modified**.
Recreate it after any `npm ci` (or just re-run `buildCmd`).

The barrel it points at is generated by `prepare-defaults.mjs`, which also decides the component
names — see below.

## Converter quirk: `cfg.tsconfig` must be a paths-only file
`lib/bundle.mjs`'s `tsconfigPathsPlugin` strips block comments with
`/\/\*[\s\S]*?\*\//g` **before** `JSON.parse`. In a normal tsconfig the `/*` inside the alias key
`"@/*"` opens a "comment" that runs to the first `*/` — which is inside a glob such as
`"src/**/*.ts"`. Everything between is deleted, `JSON.parse` throws, and the plugin's `catch`
returns `null` **silently**: no diagnostic, no `[TAG]`, the build just fails much later with
`Could not resolve "@/shared/..."` from every aliased import.

Pointing `cfg.tsconfig` at `tsconfig.web.json` therefore does not work. `.design-sync/tsconfig.paths.json`
(committed) carries only `baseUrl` + `paths` and no globs, so it survives the stripper.
**If the repo's real aliases change, update that file too — it is a hand-maintained copy.**
Verify a change with:

    node --input-type=module -e "import {tsconfigPathsPlugin} from './.ds-sync/lib/bundle.mjs';
    console.log(tsconfigPathsPlugin('/Users/minhkhoa/IntroSE/node_modules/tixhub/.design-sync/tsconfig.paths.json') ? 'ok' : 'NULL')"

## `App` is excluded from the component set
`src/App.tsx` imports legal copy as `./content/legal/*.md?raw` — a Vite-only `?raw` suffix esbuild
has no loader for, which fails the whole bundle. It is the router root, not a design-system
component, so `componentSrcMap: {"App": null}` drops it.

## `srcDir` is `src/components`, not `src`
`componentSrcMap: {"App": null}` does **not** keep a file out of the bundle. Reading
`lib/source-kit.mjs`: the synth entry (step 2) is written from a raw walk of `srcDir` filtered only
by `SRC_IMPL_RX`/`NON_IMPL_RX`; `componentSrcMap` is applied later (step 3) and prunes the component
*list* only. So `src/App.tsx` kept getting compiled — and failing on its `?raw` markdown imports —
even while excluded as a component.

Setting `srcDir` to `src/components` is the correct fix and is semantically right anyway: it is
exactly the design-system surface, and it also keeps `src/pages`, `src/services`, `src/hooks`, and
`main.tsx` out of the bundle. If a DS-worthy component is ever added outside `src/components`, pin
it with a non-null `componentSrcMap` entry rather than widening `srcDir` back to `src`.

## `.js` alias specifiers need the shim tree
`src/components/**` imports shared modules by their *emitted* extension —
`@shared/ads/types.js`, `@shared/admin/types.js` — while the files on disk are `.ts`.
`tsconfigPathsPlugin` only ever APPENDS extensions to the resolved stem (`types.js`, `types.js.ts`,
…), so it can never find `types.ts`. Most of those imports are `import type` and erase, but
`AdsScreen.tsx` imports the value `AD_PLACEMENT_LABELS`, so the bundle genuinely fails.

`.design-sync/prepare-shims.mjs` (committed) mirrors `shared/**/*.ts` into
`.design-sync/.cache/shims/shared/**/*.js`, each shim re-exporting the real source (plus its default
when it has one). `tsconfig.paths.json` lists that tree as a **second** target on each rule, so it is
only consulted after the real path misses. Re-run it whenever `shared/` gains a module — it is part
of `buildCmd`.

## `export default` components need `prepare-defaults.mjs`
94 of the 110 files under `src/components` use `export default`. The synthesized entry is
`export * from "<file>"` per file, and **`export *` never re-exports a default** — so those
components were compiled into the bundle but never reachable, and validate failed with
`[BUNDLE_EXPORT] 93/144 not a component on window.TixHub`.

`.design-sync/prepare-defaults.mjs` (committed) writes
`.design-sync/.cache/named-defaults.ts` — one `export { default as <Basename> } from "<file>"` per
default-exporting file — wired in through `cfg.extraEntries`. That merges the names onto the global
**without** touching `srcDir`, so component discovery and src-enrichment keep reading the real
files and the group layout is unchanged.

Two things the generator guards, both worth keeping if it is ever edited:
- It skips a default whose basename is **already a named export** somewhere in the tree
  (currently just `OrganizerBusinessAnalytics`, which is on the global anyway). ESM resolves an
  ambiguous star re-export to `undefined`, so aliasing over an existing name would empty *both*.
- `src/components/admin/screens/EventPreview.tsx` exports its default as `EventBody`. The alias is
  the **basename**, so it syncs as `EventPreview`; `EventBody` still ships via its own named export.

Re-run it whenever a component file is added — it is part of `buildCmd`.

## Real prop contracts come from a generated declaration tree
The first clean build emitted **144 of 144 `.d.ts` files as empty stubs**
(`[key: string]: unknown`) — no props at all. `lib/dts.mjs` extracts props from a `.d.ts` tree, and
in synth-entry mode this repo has none, so every component reached the design agent with no API
contract. That is most of the value of the sync, so it is worth the extra build step.

`lib/dts.mjs findTypesRoot` probes, in order: `publishConfig.types` → `types`/`typings` →
`build/ts`, `dist/types`, `types`, `lib`, `dist` → the package root. **`dist/types` is the free slot
here** — it needs no `package.json` edit and lives inside the already-gitignored `dist/`. So
`buildCmd` runs:

    npx tsc -p tsconfig.web.json --declaration --emitDeclarationOnly --noEmit false --outDir dist/types

which emits ~194 declarations carrying both the real prop types and the source JSDoc (the doc
comments are what make the generated `.prompt.md` useful). If a future change makes `findTypesRoot`
pick a different directory, check that list before assuming the tree is being read.

## `EventBody` is excluded as a duplicate
`admin/screens/EventPreview.tsx` declares its default as `EventBody`, so discovery lists both
`EventPreview` (the alias `prepare-defaults.mjs` puts on the global) and `EventBody` (the declared
name, which nothing exports). That is the one remaining `[BUNDLE_EXPORT]` failure, so
`componentSrcMap: {"EventBody": null}` drops it — the component itself still syncs, as `EventPreview`.

## Why the stylesheet and fonts are REAL FILES inside `node_modules/tixhub/`
`cfgPath` bounds `cssEntry` to `PKG_DIR` and compares **realpaths**. Once `node_modules/tixhub`
became a real directory with symlinked children, a `cssEntry` reached through the `.design-sync`
symlink realpath'd back to the repo, landed outside the package, and was dropped with a single
quiet line:

    ! cssEntry: .design-sync/.cache/tailwind-compiled.css resolves outside the package — skipped

The build still exits 0 and validate still exits 0 — `[CSS_RUNTIME]` is non-blocking and reads as a
normal CSS-in-JS result — but `styles.css` becomes a one-line "runtime" stub and **every card
renders in browser-default serif with no tokens and no swatches**. The only reason it was caught is
that the first authored preview was graded from its screenshot.

`extractFonts` applies the same realpath rule per `url()`, so the woff2s must be real copies too.
`prepare-pkgdir.mjs` therefore writes `ds-styles.css` and `fonts/*.woff2` as real files and symlinks
only `src`, `shared`, `dist`, `.design-sync` (whose config fields are bounded to the *workspace*
root, where symlinks are fine).

**Watch for this on re-sync**: `grep 'cssEntry' <build log>` — a "resolves outside the package" line
means the cards are unstyled no matter what the exit codes say. Confirm positively instead with
`css: node_modules/tixhub/ds-styles.css (105 KB, copied)`.

## Previews: the surface provider is what makes cards look like the product
TixHub components paint a foreground but no background — they assume the app shell supplies
`bg-xanh-pho` (surface) and `text-beige-kem` (ink). On a preview card's bare white page,
`text-beige-kem` resolves to the light theme's burgundy on white: legible enough to pass every
automated check, and nothing like the product.

`.design-sync/preview-surface.tsx` (committed) exports `DsPreviewSurface`, wired in through
`cfg.extraEntries` + `cfg.provider`, so it wraps **every** card including the floor cards.
`src/index.css`'s default `:root` block is the LIGHT palette, so no `data-theme` is set; add
`data-theme="dark"` on that wrapper to preview the dark palette.

## Preview overrides and why each exists
- `BlockPalette` — `column`, `600x1120`. It is a full-height rail; at the default cell height the
  geometry row, free-draw toggle and colour swatches all fell below the fold, which also made the
  `Drawing` variant look identical to `Default`.
- `EventFlowRail` — `column`, `1200x460`. Clips horizontally at default width; at 1200 it switches
  to a vertical layout, so what it then needs is HEIGHT, not more width.
- `CancelEventModal` — `column`, `900x1000`. Centres itself in the viewport and is taller than a
  default cell, so the header and body were cut off from the top.

## Known render warns (expected — do not chase on re-sync)
- `[EXPORT_COLLISION] ./.design-sync/.cache/named-defaults.ts exports N name(s) the main package
  also exports`. A false positive here: it compares NAME LISTS, and the component names are known
  from the src scan even though `export *` never puts the defaults on the global. Runtime proof is
  validate's `[BUNDLE_EXPORT]` line, which is clean.
- `[CSS_RUNTIME] no static CSS found` — refers only to the scrape; `cfg.cssEntry` is set and the
  cards verifiably render styled. The build log line to trust is
  `css: node_modules/tixhub/ds-styles.css (105 KB, copied)`.
- `thin` flags on small primitives (`Td`, `Th`, `Kpi`, `Field`, `SectionHead`, `StarRating`,
  `BookingLayout`, `CategoryRow`, `ConfirmDialog`, `FormField`, `InfoCard`, `LegalPage`,
  `BookingSection`) — these really are a few pixels tall unauthored. Not failures.

## Components that cannot be previewed statically
`TierPanel` and `ShowtimeList` take only ids (`showtimeId`, `eventId`) and fetch their own data, so
a static card can only ever show a loading or empty state. `ReviewMenu` owns its open state and
starts closed, so its item sets are indistinguishable in a screenshot — its preview is deliberately
ONE export on a composed comment row rather than two identical cells. The chart-editor surfaces
(`ChartEditor`, `SeatCanvas`, `LayersPanel`, `FloorPlanPanel`, `ShowtimeMapPanel`) need a full
`ChartDocument` fixture and are interaction-driven; they ship on the floor card for now.

## Re-sync risks (read this first next run)
- **`node_modules/tixhub/` is not in git.** Re-run `buildCmd` after any `npm ci` or fresh clone, or
  the build dies on `ENOENT … node_modules/tixhub/package.json`. All five steps must run in order:
  vite build → tsc declarations → prepare-shims → prepare-defaults → prepare-pkgdir.
- **The stylesheet can vanish silently.** If `cfgPath`'s realpath bound ever rejects `cssEntry`
  again, both build and validate still exit 0 and every card renders unstyled. Confirm the positive
  line `css: node_modules/tixhub/ds-styles.css (105 KB, copied)` on every run.
- **`.design-sync/tsconfig.paths.json` is a hand-maintained copy** of the repo's aliases. If
  `tsconfig.web.json` gains or changes a path, update it too — nothing cross-checks them.
- **`conventions.md` enumerates PURGED Tailwind classes.** The shipped CSS only contains utilities
  the app already uses, so the class list is only true for this build. If components stop using a
  class, it leaves the bundle and the header's claim goes stale — re-verify the list against
  `_ds_bundle.css` on every re-sync.
- Preview grades live in the gitignored `.cache/`; with no upload yet there is **no `_ds_sync.json`
  anchor**, so the next run re-verifies everything from scratch. That is the correct safe state.

## Upload status (2026-08-20)
`DesignSync(create_project)` returned HTTP 500 on four attempts across two names, while
`list_projects` succeeded and returned an empty list — the create endpoint was down, not auth.
**No project exists and no `projectId` is pinned.** The bundle is complete and validated at
`ds-bundle/`; the next run creates the project and uploads. Nothing about this run needs redoing.
