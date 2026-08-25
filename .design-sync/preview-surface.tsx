import type { ReactNode } from 'react';

/**
 * The surface every preview card renders on.
 *
 * TixHub components paint their own foreground but not their background: they
 * assume they sit inside the app shell, which carries `bg-xanh-pho` (the
 * surface token) and `text-beige-kem` (the ink token). Rendered on a preview
 * card's bare white page, `text-beige-kem` resolves to the light-theme's
 * burgundy against plain white — legible-ish, wrong, and nothing like the
 * product.
 *
 * Wired in through cfg.provider so it wraps EVERY card, authored or floor.
 * The default `:root` palette in src/index.css is the light one, so no
 * `data-theme` is set here; add `data-theme="dark"` to preview the dark
 * palette instead.
 */
export function DsPreviewSurface({ children }: { children?: ReactNode }) {
  return (
    <div className="bg-xanh-pho text-beige-kem font-sans p-4">
      {children}
    </div>
  );
}
