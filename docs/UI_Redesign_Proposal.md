# TixHub UI Redesign Proposal — "Nectar" direction

Status: **PROPOSAL — nothing implemented.** Review, mark up, then I execute.
Reference: `UI.png` (Nectar candy cart site, ATNN Design).

---

## 0. What actually makes the reference look like that

It is not primarily a palette. It is five things stacked:

| # | Device | What it does |
|---|--------|--------------|
| 1 | **Full-bleed colour bands** | Page is a stack of edge-to-edge panels (cream → tomato red → cream → periwinkle). No single background colour running the whole page. |
| 2 | **Scalloped / notched panel edges** | Panels meet through a scallop, a bunting row, or a checkerboard strip — never a plain straight seam. |
| 3 | **Hard-edge, no-blur styling** | 2px solid ink borders, flat offset shadows. Zero `backdrop-blur`, zero translucent `white/10` layers. |
| 4 | **Sticker layer** | Cut-out objects (cherries, gummies, tape strips, hand-drawn arrows, circled highlight) sit *on top of* the layout, slightly rotated, breaking the grid. |
| 5 | **Type contrast** | Large warm serif display + tiny uppercase letterspaced labels + plain small sans body. Three very different sizes, almost nothing in between. |

The current TixHub is the exact opposite on all five: one dark background, straight seams, translucent glass surfaces, blur shadows, no decorative layer, single sans family.

**So this is a restyle, not a recolour.** Recolouring alone will look wrong.

---

## 1. The one structural decision I need you to confirm first

**The reference is a light design. TixHub is dark-first** (`src/index.css:20-21`, `color-scheme: dark`).

Good news: the codebase is already semantically set up for the flip. `xanh-pho` is *always* background and `beige-kem` is *always* foreground — the existing light theme (`index.css:29-36`) already swaps their values. So flipping the default costs nothing structurally.

Proposal: **cream becomes the default, the existing toggle keeps a dark variant** ("Đêm diễn" — deep burgundy, not navy), so the `Sun`/`Moon` button in `Header.tsx:132-139` keeps working.

> ❓ **Q1 — Confirm: cream/light default, dark stays as an alternate?** Or keep dark as default and apply the Nectar shapes to a dark palette?

---

## 2. Colour tokens

### 2a. Values

Sampled from `UI.png`:

| Role | New hex | Swatch source in reference |
|------|---------|----------------------------|
| `--color-cream` | `#FDF6EA` | main page background |
| `--color-ink` | `#8A0C24` | all headings + body text (burgundy, never black) |
| `--color-tomato` | `#D93025` | red band, primary buttons |
| `--color-bubblegum` | `#FBD0DC` | header bar, price tag chips |
| `--color-periwinkle` | `#BFC0F2` | candy-club band, circled-highlight stroke |
| `--color-peach` | `#F7A97C` | scallop price blob |
| `--color-cream-2` | `#FFFCF5` | raised cards on cream (barely lighter) |
| `--color-ink-soft` | `#B4566A` | muted/secondary text (ink at ~60% but opaque) |

### 2a-bis. Dark mode — revised

**Superseded first pass.** The original version held the accents fixed and only flipped
background/foreground. That broke three ways:

1. `bubblegum` / `periwinkle` / `peach` are **light tints**. In light mode they are *fills* with
   ink text on top. On a dark background they become blinding blocks and invert meaning.
2. `shadow-[4px_4px_0_ink]` — in dark, `ink` is cream, so the hard shadow becomes a bright slab.
   Shadow needs its own token, decoupled from `ink`.
3. The **full-bleed band rhythm** — the central device of the whole direction — had no dark
   equivalent at all, so dark mode lost the structure that makes the design work.

Revised approach: **role-preserving inversion, not a different mood.** Every accent gets a dark
*band variant* for large fills. The bright tints keep identical values in both modes but demote to
strokes, badges and stickers only — so the sticker layer looks the same in both modes and acts as
the continuity anchor.

| Token | Light | Dark | Role in dark |
|---|---|---|---|
| `surface` | `#FDF6EA` | `#260810` | page background |
| `surface-2` | `#FFFCF5` | `#35101B` | raised card |
| `ink` | `#8A0C24` | `#FDF6EA` | text, 2px borders |
| `ink-soft` | `#B4566A` | `#D9A8B2` | muted text |
| `shadow` *(new)* | `#8A0C24` | `#000000` @ 55% | hard offset shadow |
| `tomato` | `#D93025` | `#D93025` | fill only |
| `tomato-band` *(new)* | `#D93025` | `#7A1710` | full-bleed band |
| `bubblegum` | `#FBD0DC` | `#FBD0DC` | sticker / badge fill |
| `bubblegum-band` *(new)* | `#FBD0DC` | `#4A1526` | full-bleed band |
| `periwinkle` | `#BFC0F2` | `#BFC0F2` | sticker / stroke |
| `periwinkle-band` *(new)* | `#BFC0F2` | `#2E2A5C` | full-bleed band |
| `peach` | `#F7A97C` | `#F7A97C` | price blob |
| `peach-band` *(new)* | `#F7A97C` | `#5A2E1C` | full-bleed band |

Bands survive dark mode as deep rust / deep plum / deep indigo. Rhythm preserved, mood not hijacked.

### 2a-ter. Contrast results

| Pair | Ratio | Verdict |
|---|---|---|
| cream on `surface` dark `#260810` | 17.4:1 | pass |
| `peach` as text on dark | 9.7:1 | pass |
| `periwinkle` as text on dark | 10.7:1 | pass |
| `bubblegum` as text on dark | ~12:1 | pass |
| `tomato` as text on dark | 3.9:1 | **fail** |
| `tomato` as text on cream (light) | 4.45:1 | **fail** |
| cream text on `tomato` fill | 4.45:1 | marginal |
| `#FFFFFF` text on `tomato` fill | 4.77:1 | pass |

Two rules fall out:

- **`tomato` is fill-only, never text — in both modes.** This is also what the reference does: red is
  never a text colour there, headings are always burgundy `#8A0C24`.
- **CTA button labels are `#FFFFFF`, not cream.**

Textures (`paper-grid`, `paper-stripe`) must be drawn with `currentColor` at low alpha rather than a
fixed hex, or they invert wrong.

> Note: the reference site has no dark mode. Keeping ours costs a full second palette plus the band
> variants above. Going light-only would be cheaper with fewer failure modes — but the toggle already
> exists and works (`Header.tsx:132-139`), so the recommendation is to keep it.

### 2b. Naming — this is the annoying part

Current token names are **descriptive, not semantic**, and they are used **1187 times** across 25 `.tsx` files:

```
beige-kem   432    xanh-pho     91
cam-dat     144    la-co       100
burgundy    120
```

If we keep the names, `burgundy` would hold tomato red and `beige-kem` ("cream") would hold dark burgundy ink. Every future edit misreads.

**Recommendation: rename to semantic tokens in one mechanical pass.**

```
xanh-pho   → surface      (background)
cream-2    → surface-2    (new: raised card)
beige-kem  → ink          (foreground)
cam-dat    → peach        (secondary accent)
burgundy   → tomato       (primary accent / CTA)
la-co      → periwinkle   (tertiary accent)
```

It is a find/replace over `src/**/*.tsx` + `index.css`, verifiable by grepping the old names to zero. No logic touched.

> ❓ **Q2 — Rename tokens (recommended), or keep old names with new values?**

---

## 3. Typography

| Slot | Now | Proposed | Why |
|------|-----|----------|-----|
| Display | Space Grotesk | **Fraunces** (700, `opsz` 72, `SOFT` 40, `WONK` 1) | Warm high-contrast serif with a soft/wonky axis — closest free match to the reference headline. |
| Body | Inter | **DM Sans** | Slightly rounder and warmer than Inter at small sizes; Inter reads too corporate next to Fraunces. |
| Mono | JetBrains Mono | **keep** | Already carries prices, times, seat codes, ratings. Works with the ticket-stub idea. |

New label style used everywhere the reference uses one — section eyebrows, badges, button text:

```css
.label-eyebrow {
  font-family: var(--font-sans);
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.16em;
}
```

Note: this **replaces** the current `tracking-normal` on uppercase button text (`Header.tsx:106`, `113`, `127` etc.), which today renders uppercase with no letterspacing — that reads cramped.

> ❓ **Q3 — Fraunces + DM Sans OK?** Alternative pairing if you want something less bookish: **Instrument Serif** + keep **Inter**.

---

## 4. Shape language

The single biggest visual change. Applies to every surface.

| Property | Now | Proposed |
|----------|-----|----------|
| Border | `border border-beige-kem/10` (1px, translucent) | `border-2 border-ink` (2px, solid) |
| Shadow | `shadow-2xl` (large blur) | `shadow-[4px_4px_0_var(--color-ink)]` (hard offset, no blur) |
| Card radius | `rounded-2xl` (16px) | `rounded-[20px]`, plus scallop on hero/feature panels |
| Button radius | `rounded-xl` (12px) | `rounded-full` pill |
| Badge | `rounded-full` + `backdrop-blur` | `rounded-full`, solid fill, `rotate-[-3deg]` sticker |
| Glass | `bg-white/[0.04]`, `backdrop-blur-xl` | **removed entirely** — solid `surface-2` |

Current radius usage for scale: `rounded-xl` ×88, `rounded-2xl` ×42, `rounded-full` ×28, `rounded-lg` ×27.

New CSS utilities to add in `src/index.css`:

```css
.edge-scallop     /* repeating radial-gradient mask — scalloped panel top/bottom */
.edge-bunting     /* the hanging-circles row under the red band */
.edge-checker     /* checkerboard strip between panels */
.paper-grid       /* faint graph-paper background, hero only */
.paper-stripe     /* candy stripes, one band only */
.shadow-hard      /* 4px 4px 0 ink */
.sticker          /* rotate -3deg + hard shadow + 2px border */
```

All pure CSS. No new dependencies.

---

## 5. Icons

`lucide-react` is already in use — 22 icons: `AlertTriangle ArrowDown ArrowUp Camera Check CheckCircle2 Clock Eye EyeOff Info Loader2 LogOut Mail MonitorSmartphone Moon PauseCircle Pencil ShieldCheck Store Sun User X`.

**Keep lucide for everything functional** (close, show/hide password, loading, status). Two changes:
- `strokeWidth={2.5}` (default 2 looks thin against 2px borders)
- functional icons sit in a **circular chip**: `grid place-items-center h-9 w-9 rounded-full border-2 border-ink bg-bubblegum`

**Add a decorative sticker layer** — the reference's cherries/gummies/tape/arrows. These are *not* icons, they are illustration. Written as inline SVG components in a new `src/components/decor/`:

```
GraphPaper.tsx     ScallopEdge.tsx    BuntingEdge.tsx
TapeStrip.tsx      HandArrow.tsx      CircleHighlight.tsx
StarBurst.tsx      TicketStub.tsx     ScallopBlob.tsx
```

Motif choice matters — the reference uses candy because it sells candy. TixHub sells event tickets.

> ❓ **Q4 — decorative motif set?**
> **(a) Ticketing** — stubs, perforations, barcodes, star ratings, tape. Safest, on-brand.
> **(b) Stage/cinema** — curtains, spotlights, film strip, popcorn, marquee bulbs. Warmer, riskier.
> **(c) Abstract only** — scallops, arrows, blobs, stars, no objects. Cheapest, most timeless.

---

## 6. Component-by-component change list

### 6.1 `Header.tsx` — restructure

Now: two rows (wordmark + search + 4 buttons), sticky, dark, blurred, all buttons identical rounded rectangles.
Reference: one short bar, **centered wordmark**, nav left, actions right, no search in header.

Proposed:

```
┌──────────────────────────────────────────────────────────────┐  bubblegum bar,
│  KHÁM PHÁ   SỰ KIỆN        TixHub        VÉ CỦA TÔI  ●Avatar │  2px ink bottom border
└──────────────────────────────────────────────────────────────┘
```

- Wordmark centered, Fraunces, `text-ink`. The `Music / Stage / Film` sub-line (`Header.tsx:87-89`) is dropped — it does not survive centering. Moves to the hero.
- **Search moves out of the header into the hero** as a large pill input. On scroll-past-hero it returns as a compact search icon that expands. (Search is a primary action here in a way it is not on the reference site — flagging this as the biggest deviation.)
- `Admin` button (`Header.tsx:125-131`) moves into the avatar dropdown — it does not belong in a public nav bar.
- Theme toggle becomes a small pill labelled `☀ NGÀY` / `☾ ĐÊM` rather than a bare icon square.

> ❓ **Q5 — search out of the header?** Alternative: keep the two-row header and just restyle it (lower risk, less like the reference).

### 6.2 `HeroVideo.tsx` — biggest rework

Now: full-bleed dark video, text overlaid on it.
Reference hero: cream + graph paper, big serif headline **left**, product photo **right**, hand-drawn arrow pointing at the CTA, stickers scattered around.

Proposed:

```
┌─────────────────────────────────────────────────────────┐
│ ░░ graph paper ░░                              ✦        │
│  (ĐANG DIỄN TẠI TP.HCM)                                 │
│                                    ┌───────────┐        │
│  Sự kiện bạn                       │  video /  │  ← rotated 2deg
│  không muốn bỏ lỡ                  │  poster   │    tape at corners
│                                    └───────────┘        │
│  Nhạc sống, sân khấu, phim…                 ╭ "còn vé   │
│  ╭──────────────────────────╮                  hôm nay!"│
│  │ 🔍 Tìm sự kiện…          │  ← hero search    ╯       │
│  ╰──────────────────────────╯                           │
│  ( MUA VÉ )  ↝ hand-drawn arrow                         │
│                                                     ✦   │
└─────────────────────────────────────────────────────────┘
```

Video keeps all current behaviour (autoplay-muted, play/pause, mute, poster fallback) — it just lives in a bordered rotated card instead of being the background. Controls become circular chips on the card edge.

### 6.3 `EventGrid.tsx` — bands + sticker cards

Section header (`EventGrid.tsx:44-56`): eyebrow `KHÁM PHÁ` + Fraunces headline, centered. Match count becomes a pill, not loose mono text.

**Featured pair** (`:58-111`): keep the 4/2 column split. Wrap in a **tomato-red full-bleed band** with a bunting edge on top — this is the reference's second panel exactly. `Banner nổi bật` badge becomes a rotated sticker.

**Event card** (`:129-236`) — currently 5 stacked info blocks separated by hairlines; visually mushy. Proposed:

```
┌════════════════════════════┐   2px ink border, 4px hard shadow
│ [CÒN VÉ]↺        image     │   status badge = rotated sticker
│                     ( ♡ )  │   wishlist = circular chip
├════════════════════════════┤
│ T16 ·  ★ 4.8 (120)         │   one metadata row
│                            │
│ Tên sự kiện ở đây          │   Fraunces, 2 lines
│ original title             │
│                            │
│ 📅 12/08 · 20:00           │   icon chips replace
│ 📍 TP.HCM · Nhà hát Hòa Bình│   "Ngày"/"Địa điểm" text labels
│                            │
│ ┌──────────────────────┐   │   combo strip: bubblegum fill
│ │ 🎁 Combo: giảm 20%   │   │
│ └──────────────────────┘   │
│                            │
│   ╭───╮                    │
│   │350│  ( ĐẶT VÉ )        │   price in peach scallop blob,
│   │ K │                    │   CTA = tomato pill
│   ╰───╯                    │
└════════════════════════════┘
```

Key change: the `Ngày` / `Địa điểm` / `Vé` word-labels (`:199`, `:203`, `:209`) become icons. Saves a column of width, matches the reference's terse info rows.

Price as a **scallop blob** is lifted directly from the reference's `$399 / $8 / $99` cluster.

### 6.4 `EventFilters.tsx`
Dropdowns/inputs → **pill chips with 2px borders**; active chip = solid tomato fill, white text, rotate 0 (no sticker rotation on interactive filters — it hurts scanability).

### 6.5 `TicketTicket.tsx`
Real ticket stub: perforated divider (repeating radial-gradient), two half-circle notches punched in the side edges, barcode strip, bubblegum fill. This component benefits most from the direction.

### 6.6 `SeatLayout.tsx` / `SeatMapView.tsx` / `SeatMapBuilder.tsx`
**Functional colours stay semantic** (available / held / sold / selected) — restyled to the new palette but *not* re-mapped to decorative colours. Seats get 2px borders and the hard-shadow treatment on the selected state only. No stickers anywhere near the seat map.

### 6.7 Modals — `AuthModal` `ConfirmDialog` `CheckoutForm` `AccountPage` `account/primitives.tsx`
Drop `backdrop-blur`; overlay becomes flat `ink/70`. Panel: cream, 2px border, hard shadow, scallop top edge. Inputs in `account/primitives.tsx` get the 2px + pill treatment once and the rest inherit it.

### 6.8 `AdminPanel` `AdminModeration` `OrganizerPanel` `BookingHistory`
**Restyled, not restructured.** New tokens + borders + type, tables stay tables. Decorative layer deliberately excluded — these are work screens, stickers would be noise.

> ❓ **Q6 — agree admin/organizer screens stay plain?**

---

## 7. Scope, order, risk

| Phase | Work | Files | Risk |
|-------|------|-------|------|
| P1 | Tokens, rename pass, fonts, CSS utilities | `index.css` + mechanical sweep of 25 `.tsx` | Low — mechanical, grep-verifiable |
| P2 | `decor/` SVG components | 9 new files | Low — additive |
| P3 | Header + Hero | 2 files | **High** — real layout change, needs your sign-off on Q5 |
| P4 | EventGrid card + bands + Filters | 2 files | Medium |
| P5 | TicketTicket, seat maps, modals | ~8 files | Medium |
| P6 | Admin/organizer restyle | 4 files | Low |

Total: ~6300 LOC across 25 components in scope. No dependency changes, no logic changes, no API changes. Tests do not assert on class names, so nothing should break — I will run the suite after each phase to confirm.

Suggested: **do P1 + P2 + P3 first, you look at it running, then decide whether to continue.** Avoids repainting 25 files before you have seen the direction on screen.

---

## 8. Questions to answer before I start

1. **Q1** — Cream/light as default, dark as alternate?
2. **Q2** — Rename tokens to semantic names?
3. **Q3** — Fraunces + DM Sans, or Instrument Serif + Inter?
4. **Q4** — Decorative motif: (a) ticketing, (b) stage/cinema, (c) abstract only?
5. **Q5** — Move search out of the header into the hero?
6. **Q6** — Admin/organizer screens stay plain?
7. **Q7** — How far on the sticker layer? **subtle** (edges + scallops only) / **medium** (+ tape, arrows, a few stickers) / **full Nectar** (stickers on most sections)?
8. **Q8** — Start with P1–P3 for a look, or commit to the whole thing?
