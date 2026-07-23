// Client-side SEO for event pages (FR-032): server-renderable title/description + JSON-LD Event,
// built from the detail payload. The slug is the canonical URL.
import type { EventDetail, Showtime } from '@/shared/catalog/types';

const JSONLD_ID = 'event-jsonld';
const DEFAULT_TITLE = 'TixHub';

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
  const canonical = `${window.location.origin}/su-kien/${d.slug}`;
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
      availability: d.soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
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

export function clearEventSeo(): void {
  document.title = DEFAULT_TITLE;
  document.getElementById(JSONLD_ID)?.remove();
}
