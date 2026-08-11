// Client-side SEO for event pages (FR-032): server-renderable title/description + JSON-LD Event,
// built from the detail payload. The slug is the canonical URL.
import type { EventDetail, Showtime } from '@/shared/catalog/types';
import { screenToPath } from '../routes';

const JSONLD_ID = 'event-jsonld';
const DEFAULT_TITLE = 'TixHub';
/** Everything `applyEventSeo` adds, so leaving an event page can take all of it back off again. */
const EVENT_META: ReadonlyArray<[string, 'name' | 'property']> = [
  ['description', 'name'],
  ['og:title', 'property'],
  ['og:description', 'property'],
  ['og:image', 'property'],
];

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

export function applyEventSeo(d: EventDetail, showtimes: Showtime[]): void {
  document.title = `${d.title} · TixHub`;
  setMeta('description', d.seo.description);
  setMeta('og:title', d.title, 'property');
  setMeta('og:description', d.seo.description, 'property');
  if (d.seo.imageUrl) setMeta('og:image', d.seo.imageUrl, 'property');
  // Built from the router's own table: a hand-written path here silently rots into a canonical URL
  // that 404s. It used to say /su-kien/:slug, which no route has ever served.
  const canonical = `${window.location.origin}${screenToPath('detail', { eventSlug: d.slug })}`;
  setCanonical(canonical);

  const venue = showtimes[0]?.venue;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: d.title,
    description: d.seo.description,
    image: d.seo.imageUrl ?? undefined,
    startDate: d.earliestShowtime ?? undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    location: venue ? { '@type': 'Place', name: venue.name, address: venue.city } : undefined,
    offers: d.tiers.map((t) => ({
      '@type': 'Offer',
      price: t.price,
      priceCurrency: 'VND',
      // A finished event reports `soldOut: false` — it has no upcoming showtime for that flag to be
      // about — so testing `soldOut` alone would tell a search engine the tickets are in stock.
      // `OutOfStock` rather than `SoldOut`, which would claim they all sold.
      availability: !d.hasUpcoming
        ? 'https://schema.org/OutOfStock'
        : d.soldOut
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
    })),
    url: canonical,
  };

  let script = document.getElementById(JSONLD_ID);
  if (!script) {
    script = document.createElement('script');
    script.id = JSONLD_ID;
    (script as HTMLScriptElement).type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(jsonld);
}

/**
 * Takes every event tag back off. Now that each screen has its own URL, a page like /bookings can be
 * shared and crawled on its own — leaving the description, og: tags, canonical and the Event JSON-LD
 * behind would describe it as whichever event the visitor happened to open first. Removing only the
 * title and the JSON-LD, as this used to, left the rest of that lie in place.
 */
export function clearEventSeo(): void {
  document.title = DEFAULT_TITLE;
  document.getElementById(JSONLD_ID)?.remove();
  for (const [name, attr] of EVENT_META) {
    document.head.querySelector(`meta[${attr}="${name}"]`)?.remove();
  }
  document.head.querySelector('link[rel="canonical"]')?.remove();
}
