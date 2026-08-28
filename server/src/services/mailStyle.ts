/**
 * How TixHub mail is set, in one place — because a mail client is not a browser.
 *
 * Three things a page can take for granted and a mail cannot:
 *
 * 1. FONT STACKS RESOLVE. The templates asked for `ui-monospace, SFMono-Regular, Menlo, monospace`,
 *    which is a macOS stack: `ui-monospace` is a CSS4 generic that Word-engine Outlook has never
 *    heard of, and SF Mono and Menlo do not exist off a Mac. On a Windows laptop all three miss and
 *    the client falls through to the `monospace` generic, which is Courier New — so the ticket badge
 *    and the code sitting beside the mail's own title came out in a thin typewriter face that
 *    matched nothing around it. Consolas is the Windows equivalent and ships with Vietnamese
 *    coverage; the list below names a real font per platform before it names a generic.
 *
 * 2. FONT-FAMILY INHERITS. Outlook on Windows renders through Word, which does not carry
 *    `font-family` from an ancestor `<div>` into a `<table>` — the property stops at the table
 *    boundary and the cell falls back to Times New Roman. Every layout here is tables, so every
 *    `<td>` that holds text has to name its own face. Nested tables need it again.
 *
 * 3. THE CHARSET IS KNOWN. The templates were bare `<div>` fragments with no document around them,
 *    so a client that does not trust the MIME header has nothing to read the encoding from and gets
 *    to guess. Guessing wrong turns "Đặt lại mật khẩu" into mojibake. `mailDocument` gives it a head
 *    to find the answer in.
 */

/*
 * 4. THE QUOTES INSIDE A STACK MUST NOT BE THE QUOTES AROUND THE ATTRIBUTE.
 *
 * These stacks are interpolated into `style="…"` attributes. Written with double quotes —
 * `"Segoe UI",Roboto,…` — the attribute ENDS at the quote before `Segoe`, and every declaration
 * after `font-family:` in that attribute falls outside it and is parsed as stray tag attributes.
 * That silently dropped colours, sizes and weights across roughly thirty style attributes in both
 * templates: the mail rendered in the client default from the font-family onwards, which is the
 * opposite of what the stacks were added to achieve. CSS accepts single quotes for family names, so
 * they are what these use.
 */

/** Segoe UI on Windows, San Francisco on Apple, Roboto on Android — all with Vietnamese. */
export const MAIL_SANS = `'Segoe UI',Roboto,-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif`;

/** Consolas on Windows, Menlo on Apple, DejaVu on Linux. Courier New is the last resort, not the first. */
export const MAIL_MONO = `Consolas,Menlo,'DejaVu Sans Mono','Liberation Mono','Courier New',monospace`;

/**
 * A body fragment, wrapped in a document that declares its own encoding and language.
 *
 * `lang="vi"` is what tells a client to pick a Vietnamese-capable face when it has to choose one
 * itself, and to hyphenate and read the text as Vietnamese rather than as unknown Latin.
 */
export function mailDocument(inner: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:${MAIL_SANS}">${inner}</body>
</html>`;
}

/*
 * The ticket's palette, kept here so mail and app cannot drift apart again.
 *
 * These are `src/index.css`'s redesigned tokens, read by ROLE rather than by their pre-redesign
 * names (that file says the same): `xanh-pho` is the surface, `beige-kem` is the ink, `burgundy` is
 * the tomato accent. The mail had been left on the palette from BEFORE that swap — deep green paper,
 * cream card, plum band — so every message TixHub sent looked like a different product from the one
 * the reader had just bought from.
 *
 * A mail cannot read a CSS variable, so the values are literals. Changing a token in `index.css`
 * means changing it here too; there is no build step that could keep them in sync, and a stale
 * literal is a visible drift rather than a silent one.
 */

/** The page behind the ticket — `--color-xanh-pho`. */
export const MAIL_PAPER = "#fdf6ea";
/** The ticket itself — `--color-surface-2`. */
export const MAIL_CARD = "#fffcf5";
/** Headlines and values — `--color-beige-kem`, the foreground. */
export const MAIL_INK = "#8a0c24";
/** Labels and captions — `--color-ink-soft`. */
export const MAIL_INK_SOFT = "#b4566a";
/** The head band and the button fill — `--color-burgundy`. White sits on top of it. */
export const MAIL_ACCENT = "#d93025";
/** The same hue tuned for TYPE on paper — `--color-burgundy-ink`. */
export const MAIL_ACCENT_INK = "#d12a20";
/** Hairlines and rules: ink at low strength, pre-blended because a mail client may drop rgba(). */
export const MAIL_RULE = "#e6d9c8";
/** The quiet zone a scanner looks for. Never a brand colour — a QR needs real white. */
export const MAIL_QR_TILE = "#ffffff";
