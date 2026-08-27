/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Play } from "lucide-react";

/**
 * Whether a trailer URL is something a `<video>` can actually play.
 *
 * `<video><source src="https://www.youtube.com/watch?v=…"></video>` never plays: a watch page is
 * HTML, not media, and the element fails silently — no error, no fallback, just a poster that never
 * moves. Three rows in the catalogue are exactly that, left over from seed data.
 *
 * So a link is treated as a trailer only when it names a media file or a Cloudinary video, and
 * anything else counts as "no trailer" — which is honest, and renders as nothing rather than as a
 * player that cannot work. Adding YouTube support later means an `<iframe>`, not a longer regex.
 */
export { playableTrailer } from "@shared/ads/trailer.js";

/**
 * The trailer, behind its own poster until somebody asks for it.
 *
 * Deliberately not autoplaying and not preloading: this sits under the fold on a page whose job is
 * selling a ticket, and a trailer that starts talking while somebody is choosing a seat is a
 * trailer they will close. `preload="none"` also means the file — a few megabytes on Cloudinary —
 * is not fetched for the majority who never press play.
 *
 * One press swaps the poster for a real `<video controls>` and starts it. There is no second state
 * to manage after that: the browser's own controls own pause, seek, fullscreen and volume, and
 * re-implementing them here would be a worse version of what every reader already knows.
 */
export default function TrailerPanel({
  url,
  poster,
  title,
}: {
  url: string;
  poster: string | null;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden border border-beige-kem/30 bg-black">
      {playing ? (
        <video
          src={url}
          poster={poster ?? undefined}
          controls
          autoPlay
          playsInline
          className="h-full w-full object-contain"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Xem trailer ${title}`}
          className="group absolute inset-0 h-full w-full"
        >
          {poster && (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              loading="lazy"
              /*
               * The poster is a portrait sheet and this frame is 16/9, so `contain` rather than
               * `cover` — cropping a poster to a letterbox cuts the title off it. The slack is
               * filled by the same image, overscaled and blurred, which is the treatment the event
               * cards already use.
               */
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl"
            />
          )}
          {poster && (
            <img
              src={poster}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              loading="lazy"
              className="relative h-full w-full object-contain"
            />
          )}

          <span className="absolute inset-0 bg-black/30 transition group-hover:bg-black/15" />

          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-16 w-16 place-items-center border-2 border-white bg-burgundy text-white transition group-hover:scale-105">
              <Play className="h-6 w-6 translate-x-[2px]" aria-hidden="true" fill="currentColor" />
            </span>
          </span>

          <span className="label-eyebrow absolute bottom-4 left-4 bg-black/70 px-3 py-1.5 text-white">
            Xem trailer
          </span>
        </button>
      )}
    </div>
  );
}
