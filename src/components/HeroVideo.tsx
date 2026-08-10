/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { MovieEvent } from "../types";
import { ArrowDown } from "lucide-react";

interface HeroVideoProps {
  movie: MovieEvent;
  onBookNow: () => void;
}

/**
 * Hero type size, chosen from how long the title actually is.
 *
 * A fixed size cannot serve both ends of this catalog. "Chuyện Ma Gần Nhà" is 22 characters and
 * wants to be enormous; "Đêm Nhạc Indie: Những Thành Phố Mơ Màng" is 50 and at the same size runs
 * to five or six lines — which pushes the description and the three buttons past the fold, on a
 * section that is exactly one viewport tall.
 *
 * Stepping the size down as the title grows keeps the block at roughly two lines either way, so the
 * buttons land in the same place no matter which event is featured.
 *
 * Every tier sits one step below where it started. The type shares the frame with the screen now,
 * and at the old sizes the title ran straight across it while it was still small.
 */
function titleSize(title: string): string {
  const n = title.length;
  if (n <= 20) return "text-5xl sm:text-7xl lg:text-8xl";
  if (n <= 32) return "text-4xl sm:text-6xl lg:text-7xl";
  if (n <= 44) return "text-3xl sm:text-5xl lg:text-6xl";
  return "text-3xl sm:text-4xl lg:text-5xl";
}

/**
 * How much of the section's scroll is spent growing the screen.
 *
 * The section is two viewports tall and its stage is sticky, so there is exactly one viewport of
 * scroll to play with. Spending 0→1 of it on the shape and 0→0.55 on the type means the title has
 * finished leaving well before the screen finishes opening, rather than the two racing each other.
 */
const TITLE_FADE_END = 0.55;

/**
 * Opening size, set from a ruler held against the reference site and against this one.
 *
 * Measured on the same display, and the second reading is the one to trust: at 737 × 456 px the
 * ruler read 16.1 × 10.0 cm, which puts the display at 45.8 px/cm both ways. The reference's
 * 19.5 × 12.5 cm is therefore 893 × 572 px — the two fractions below, on the 1536 × 782 viewport
 * they were measured at.
 *
 * (The first pass used a reading of 26.5 × 15.8 cm for a frame that was 1001 × 563 px, which works
 * out at 37.8 across and 35.6 down. A display does not have two scales, so that pair was off; the
 * DOM figures pulled off the reference before it were taken in a nearly square window and did not
 * survive the trip to a 16:9 desktop either.)
 *
 * The aspect that falls out is 1.561, squarer than the 16:9 the trailer itself is, so `object-cover`
 * takes a little off the sides of the video. That is the trade for matching the reference frame.
 */
const START = { widthOfViewport: 0.581, maxHeightOfViewport: 0.731 };

/** Shape of the opening frame, as measured above: 893 / 572. */
const START_ASPECT = 1.561;

/**
 * How far above the centre of the stage the small screen sits, in pixels.
 *
 * Interpolated away as it opens, because at full bleed the frame is the viewport — hold the offset
 * there and it would leave a strip of the page showing along the bottom edge.
 */
const START_RISE = 30;

/**
 * How far each pair of edges bows out at the start, as a fraction of the screen's own size.
 *
 * `border-radius` cannot draw this. One corner carries a single horizontal and a single vertical
 * radius, so making the top edge dome (horizontal radius = half the width) and the side edge dome
 * (vertical radius = half the height) are the same setting pulling in two directions — ask for both
 * and the result is an ellipse, not a tube face. So the outline is a path: four quadratic curves,
 * corners pulled inward by these two amounts, each edge bulging back out to the box at its middle.
 *
 * The sides barely move. A CRT is far more curved across than down, and past a percent or two the
 * shape stops reading as glass and starts reading as a barrel.
 *
 * Both interpolate to zero as the screen opens, so full bleed is a plain rectangle. The reference
 * site keeps its bow at full width; we do not, because there the curve is drawn inside a canvas
 * that ends before the viewport does, whereas here it would cut wedges out of the four corners of
 * a full-screen video and read as a clipping fault rather than as glass.
 */
const START_CURVE = { topBottom: 0.1, sides: 0.012 };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The tube face, as a closed path in the element's own pixels.
 *
 * Each corner sits `bx` in from the vertical edge and `by` down from the horizontal one; each edge
 * is a quadratic whose control point is mirrored the same distance on the far side, which puts the
 * curve's midpoint exactly on the box boundary. So the edges touch the full width and height at
 * their centres and only the corners are given away.
 */
function screenPath(w: number, h: number, bx: number, by: number): string {
  return (
    `path("M ${bx} ${by} ` +
    `Q ${w / 2} ${-by} ${w - bx} ${by} ` +
    `Q ${w + bx} ${h / 2} ${w - bx} ${h - by} ` +
    `Q ${w / 2} ${h + by} ${bx} ${h - by} ` +
    `Q ${-bx} ${h / 2} ${bx} ${by} Z")`
  );
}

export default function HeroVideo({ movie, onBookNow }: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const [showPoster, setShowPoster] = useState(true);

  /*
   * Written straight to the DOM as custom properties, not held in state.
   *
   * This runs on every scroll frame. Through `useState` that is a React render per frame for a
   * subtree carrying a video element; through a ref it is two `setProperty` calls on one node and
   * the browser's own compositor does the rest. `requestAnimationFrame` collapses the burst of
   * scroll events a trackpad fires into one write per painted frame.
   */
  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const type = typeRef.current;
    if (!section || !stage || !type) return;

    // Honouring the OS setting is not decoration here: a viewport-sized element changing size under
    // the reader is exactly the kind of motion the setting exists to switch off. Opened, and stays.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      stage.style.setProperty("--screen-w", "100%");
      stage.style.setProperty("--screen-h", "100%");
      stage.style.setProperty("--screen-rise", "0px");
      stage.style.clipPath = "none";
      type.style.setProperty("--type-opacity", "1");
      type.style.setProperty("--type-events", "auto");
      return;
    }

    let frame = 0;

    const write = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      // The stage is sticky for `height - viewport`, so that distance is the whole animation.
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-rect.top / travel) : 0;

      // Whichever limit binds first, so a short window shrinks the frame rather than overflowing.
      const byWidth = window.innerWidth * START.widthOfViewport;
      const byHeight = window.innerHeight * START.maxHeightOfViewport * START_ASPECT;
      const startW = Math.min(byWidth, byHeight);
      const startH = startW / START_ASPECT;

      const w = startW + (window.innerWidth - startW) * p;
      const h = startH + (window.innerHeight - startH) * p;
      stage.style.setProperty("--screen-w", `${w}px`);
      stage.style.setProperty("--screen-h", `${h}px`);
      stage.style.setProperty("--screen-rise", `${-START_RISE * (1 - p)}px`);
      stage.style.clipPath = screenPath(
        w,
        h,
        w * START_CURVE.sides * (1 - p),
        h * START_CURVE.topBottom * (1 - p),
      );

      const typeOpacity = clamp01(1 - p / TITLE_FADE_END);
      type.style.setProperty("--type-opacity", `${typeOpacity}`);
      type.style.setProperty("--type-events", typeOpacity > 0.05 ? "auto" : "none");
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", write);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", write);
    };
  }, []);

  /** Restart and play whenever the featured event changes. There is no pause control any more. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    video.load();
    setShowPoster(true);
    video
      .play()
      .then(() => setShowPoster(false))
      .catch(() => setShowPoster(true));
  }, [movie.id]);

  /*
   * Sound, as far as the browser will allow it.
   *
   * No browser will autoplay audio on a page the reader has not interacted with — Chrome, Safari
   * and Firefox all refuse, and the refusal takes the whole `play()` with it, so a video that asks
   * for sound up front simply does not start. Muted is therefore the only way "luôn phát" can be
   * true on arrival.
   *
   * The first real gesture anywhere on the page lifts the restriction, and this unmutes on it. From
   * that moment the volume is whatever the machine's is, since nothing here sets `volume`. `once`
   * on each listener makes the whole thing self-removing.
   */
  useEffect(() => {
    const unmute = () => {
      const video = videoRef.current;
      if (video) video.muted = false;
    };
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", unmute, opts);
    window.addEventListener("keydown", unmute, opts);
    return () => {
      window.removeEventListener("pointerdown", unmute);
      window.removeEventListener("keydown", unmute);
    };
  }, []);

  return (
    /*
     * Two viewports tall with a sticky stage inside, which is what turns scroll distance into the
     * animation's timeline: the reader keeps scrolling, the stage stays put, and the extra viewport
     * of travel is spent opening the screen instead of moving the page.
     */
    <section
      id="hero-trailer-section"
      ref={sectionRef}
      className="relative h-[200vh] w-full bg-black text-white"
    >
      <div className="sticky top-0 flex h-[100dvh] w-full items-center justify-center overflow-hidden">
        {/*
          The screen itself. Width, height and corner radius are driven from the scroll handler as
          custom properties, so this element is the only thing that changes and React never
          re-renders to make it happen. It starts as a set across the room and ends as the window.
        */}
        <div
          ref={stageRef}
          style={{
            width: "var(--screen-w, 58.1vw)",
            height: "var(--screen-h, 37.2vw)",
            transform: "translateY(var(--screen-rise, -30px))",
          }}
          // No drop shadow: `clip-path` clips an element's shadow along with its box, so one here
          // would be cut away the moment the path is applied rather than tracing the tube face.
          className="relative overflow-hidden bg-black"
        >
          <img
            src={movie.imageUrl}
            alt={movie.title}
            referrerPolicy="no-referrer"
            className={`absolute inset-0 z-[2] h-full w-full object-cover transition-opacity duration-700 ${
              showPoster ? "opacity-100" : "opacity-0"
            }`}
          />

          <video
            ref={videoRef}
            className="absolute left-1/2 top-1/2 z-[1] min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 object-cover"
            poster={movie.imageUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onPlay={() => setShowPoster(false)}
          >
            <source src={movie.trailerUrl} />
          </video>

          <div className="absolute inset-0 z-[3] bg-black/35" />
          <div className="absolute inset-0 z-[3] bg-gradient-to-t from-black/75 via-black/20 to-black/20" />
        </div>

        {/*
          The type sits above the screen at every size, so the layout does not change when the
          screen grows past it — only the opacity does.

          `--type-events` rather than a plain `pointer-events-auto`: the title is now the link into
          the event, and an element at `opacity: 0` still takes clicks. Without switching it off as
          it fades, the opened screen would carry an invisible hit target across its middle.
        */}
        <div
          ref={typeRef}
          className="pointer-events-none absolute inset-0 z-10 flex items-center px-5 pt-24 sm:px-10 lg:px-[8%]"
        >
          <div className="max-w-[720px] translate-y-[156px] sm:-translate-x-[70px] sm:translate-y-[295px] lg:max-w-[880px]">
            <div
              style={{
                opacity: "var(--type-opacity, 1)",
                pointerEvents: "var(--type-events, auto)" as React.CSSProperties["pointerEvents"],
              }}
            >
              {/*
               * The title, and nothing else.
               *
               * Age rating, genre, original title and the synopsis all used to sit here. They are on
               * the event's own page, one click away through this heading, and on a screen whose job
               * is to open they were four things competing with the picture.
               *
               * A `<button>` wrapping the `<h1>` rather than the other way round: the heading has to
               * stay a heading for the document outline, and a control may contain one but not the
               * reverse. `line-clamp-3` is the backstop, not the mechanism — the sizing above should
               * already keep every catalog title inside two lines; the full string stays on `title`.
               */}
              <button
                id="hero-book-now-btn"
                type="button"
                onClick={onBookNow}
                title={movie.title}
                className="block max-w-full text-left transition hover:text-cam-dat"
              >
                <h1
                  className={`line-clamp-3 font-display font-black uppercase leading-[0.9] tracking-normal ${titleSize(
                    movie.title,
                  )}`}
                >
                  {movie.title}
                </h1>
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="absolute bottom-8 right-[8%] z-10 grid h-12 w-12 place-items-center border border-white/45 bg-black/20 text-white/85 transition duration-200 hover:translate-y-1 hover:border-white hover:text-white"
          onClick={() => window.scrollBy({ top: window.innerHeight - 80, behavior: "smooth" })}
          aria-label="Cuộn xuống"
          title="Cuộn xuống"
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
