## Building with TixHub

TixHub is a Vietnamese event-ticketing product. Components are React, styled with **Tailwind v4
utility classes** bound to a named token palette. There is no theme provider and no CSS-in-JS —
styling is classes plus CSS custom properties.

### Always wrap in the app surface

Components paint a foreground but **no background**. They assume the shell supplies the surface and
ink tokens. Put every screen inside a surface wrapper or your UI renders as dark-on-white with no
product identity:

```jsx
<div className="bg-xanh-pho text-beige-kem font-sans min-h-screen">
  {/* screens go here */}
</div>
```

`:root` is the **light** palette (cream surface `#fdf6ea`, burgundy ink). Set
`data-theme="dark"` on the root element for the dark palette; every token below repaints at runtime.
Read the palette by role, not by name — the names predate a redesign:

| Token | Role |
|---|---|
| `xanh-pho` | page surface |
| `surface-2` | raised panel / card |
| `beige-kem` | primary ink |
| `ink-soft` | secondary ink |
| `burgundy` | primary accent, destructive |
| `cam-dat` | warning / attention |
| `la-co` | success / valid |
| `bubblegum` | soft highlight fill |
| `on-tint` | ink on a filled accent |

### The class vocabulary you may use

**The shipped stylesheet is a compiled, purged Tailwind build — it contains only the utilities this
app already uses.** A class you invent will not resolve, even for a token that exists. Stick to
these, or drop to `style={{ color: 'var(--color-…)' }}`, which always works.

- Surface / fill: `bg-xanh-pho` `bg-surface-2` `bg-beige-kem` `bg-burgundy` `bg-cam-dat` `bg-la-co`
  `bg-bubblegum` `bg-ink-soft`
- Ink: `text-beige-kem` `text-ink-soft` `text-burgundy` `text-burgundy-ink` `text-cam-dat`
  `text-cam-dat-ink` `text-la-co` `text-la-co-ink` `text-on-tint` `text-xanh-pho`
- Border: `border-beige-kem` `border-burgundy` `border-cam-dat` `border-la-co`
- Type: `font-sans` (body), `font-display` (headings ≥2rem), `font-meta` (labels/eyebrows),
  `font-mono`; weights `font-light` → `font-black`
- Opacity suffixes work on the ink tokens and are used heavily for hierarchy:
  `text-beige-kem/70`, `border-beige-kem/15`

Standard Tailwind layout/spacing utilities (`flex`, `grid`, `gap-*`, `p-*`, `rounded-*`) are
available as used by the app. Custom properties for motion and shape: `--ticket-radius`,
`--ease-custom`, `--ease-quint`, `--menu-panel-duration`.

### Where the truth is

Read `_ds/<folder>/styles.css` and the `_ds_bundle.css` it imports before styling — that file *is*
the emitted vocabulary. Per-component API and usage live in each component's `.d.ts` and
`.prompt.md`; the `.d.ts` carries the real prop types and the source's own doc comments.

### Idiomatic example

Library components for the controls, DS utilities for your own layout glue:

```jsx
<div className="bg-xanh-pho text-beige-kem font-sans p-6">
  <h1 className="font-display text-3xl font-black">Sơ đồ chỗ ngồi</h1>
  <div className="mt-4 grid grid-cols-[280px_1fr] gap-4">
    <SectionPanel sections={sections} seats={seats} selectedCount={0} activeSectionId={1} … />
    <div className="rounded-lg bg-surface-2 p-4">
      <TierLegend legend={tiers} />
      <ValidationPanel issues={issues} labelOfSeat={labelOfSeat} />
    </div>
  </div>
</div>
```

Copy is Vietnamese; prices are whole VND đồng formatted `2.500.000đ` (`toLocaleString('vi-VN')`).
