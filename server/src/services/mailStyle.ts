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

/** Segoe UI on Windows, San Francisco on Apple, Roboto on Android — all with Vietnamese. */
export const MAIL_SANS = `"Segoe UI",Roboto,-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif`;

/** Consolas on Windows, Menlo on Apple, DejaVu on Linux. Courier New is the last resort, not the first. */
export const MAIL_MONO = `Consolas,Menlo,"DejaVu Sans Mono","Liberation Mono","Courier New",monospace`;

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
