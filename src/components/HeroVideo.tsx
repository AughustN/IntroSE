/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { MovieEvent } from "../types";
import { Pause, Play } from "lucide-react";

interface HeroVideoProps {
  movie: MovieEvent;
  onBookNow: () => void;
  /**
   * How much of the set to build.
   *
   * `cinema` is the landing page: two viewports tall, a sticky stage, and a screen that opens out
   * of a television set as the reader scrolls. `plain` is the catalog page — the same trailer, the
   * same sound handling and the same dial, in a fixed band with no cabinet, no bow and no scroll
   * choreography. The catalog is a page you came to in order to scroll past it, and a hero that
   * eats two viewports on the way is in the way.
   */
  variant?: "cinema" | "plain";
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
const START_RISE = 40;

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

/**
 * How much of the scroll the cabinet survives.
 *
 * Shorter than the title's fade and much shorter than the screen's growth, on purpose. The set is
 * only legible while the screen is still set-sized; once the glass is half the viewport a bezel
 * around it reads as a border, not as furniture. Gone by 0.32 means it has left before that.
 */
const CHROME_FADE_END = 0.32;

/**
 * Every piece of the cabinet, as a fraction of the screen's *opening* height.
 *
 * Off the opening height rather than the live one because the set has to shrink into the glass as
 * the screen grows — driven off the live height the bezel would widen as the screen opened, which
 * is the opposite of leaving. The scroll handler multiplies all of these by `1 - p`, so at full
 * bleed every part is zero-sized as well as invisible.
 *
 * The chin is close to four times the bezel, and that asymmetry is the whole trick: an even border
 * around a picture reads as a picture frame, and only a deep bottom edge — somewhere for the grille
 * and the dials to live — reads as a television.
 *
 * The chin also sets the scale of everything standing on it. Grille height, both dials, the lamp
 * and the feet are all fractions of it rather than of the screen, so trimming this one number takes
 * the whole chin furniture down with it and the composition holds.
 */
const TV = { bezel: 0.02, chin: 0.075, foot: 0.016 };

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

export default function HeroVideo({ movie, onBookNow, variant = "cinema" }: HeroVideoProps) {
  const plain = variant === "plain";
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const [showPoster, setShowPoster] = useState(true);

  /*
   * Mirrors the element, rather than being the source of truth for it.
   *
   * The tuning dial is not the only thing that can stop this video — a fresh `movie.id` reloads it,
   * and the browser pauses it on its own when the tab goes to the background. Driving the glyph off
   * the element's own `play`/`pause` events keeps it honest through all three; a flag flipped in the
   * click handler would only be right about the one case it knows about.
   */
  const [paused, setPaused] = useState(false);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPaused(true));
    else video.pause();
  };

  /*
   * Written straight to the DOM as custom properties, not held in state.
   *
   * This runs on every scroll frame. Through `useState` that is a React render per frame for a
   * subtree carrying a video element; through a ref it is a handful of `setProperty` calls on one
   * node and the browser's own compositor does the rest. `requestAnimationFrame` collapses the
   * burst of scroll events a trackpad fires into one write per painted frame.
   *
   * The properties land on the sticky shell rather than on the screen, because the cabinet needs
   * them too and it cannot live inside the screen — `clip-path` would cut the bezel off along the
   * tube face. Custom properties inherit, so one write feeds both.
   */
  useEffect(() => {
    // Nothing about the plain band changes with scroll, so it never installs a scroll listener.
    if (plain) return;

    const section = sectionRef.current;
    const shell = shellRef.current;
    const stage = stageRef.current;
    const type = typeRef.current;
    if (!section || !shell || !stage || !type) return;

    // Honouring the OS setting is not decoration here: a viewport-sized element changing size under
    // the reader is exactly the kind of motion the setting exists to switch off. Opened, and stays.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      shell.style.setProperty("--screen-w", "100%");
      shell.style.setProperty("--screen-h", "100%");
      shell.style.setProperty("--screen-rise", "0px");
      // No set at all rather than a collapsed one: the cabinet only makes sense wrapped around a
      // small screen, and this branch never has one.
      shell.style.setProperty("--tv-opacity", "0");
      shell.style.setProperty("--tv-events", "none");
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
      shell.style.setProperty("--screen-w", `${w}px`);
      shell.style.setProperty("--screen-h", `${h}px`);
      shell.style.setProperty("--screen-rise", `${-START_RISE * (1 - p)}px`);

      // The cabinet collapses on `1 - p` and fades on its own, faster curve, so it is thinning for
      // the whole opening but has already gone by the time the glass is half the viewport.
      const k = 1 - p;
      shell.style.setProperty("--tv-k", `${k}`);
      shell.style.setProperty("--tv-bezel", `${startH * TV.bezel * k}px`);
      shell.style.setProperty("--tv-chin", `${startH * TV.chin * k}px`);
      shell.style.setProperty("--tv-foot", `${startH * TV.foot * k}px`);
      const chromeOpacity = clamp01(1 - p / CHROME_FADE_END);
      shell.style.setProperty("--tv-opacity", `${chromeOpacity}`);
      shell.style.setProperty("--tv-events", chromeOpacity > 0.05 ? "auto" : "none");

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
  }, [plain]);

  /**
   * Restart and play whenever the featured event changes.
   *
   * A new trailer always starts running, whatever the dial was left on for the last one — the flag
   * is about the video currently loaded, and this is a different video.
   *
   * `catch` sets it by hand rather than waiting for an event: a rejected `play()` leaves the element
   * paused without ever firing `pause`, so the glyph would still be claiming it is playing.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    video.load();
    setShowPoster(true);
    video
      .play()
      .then(() => {
        setShowPoster(false);
        setPaused(false);
      })
      .catch(() => {
        setShowPoster(true);
        setPaused(true);
      });
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
      className={`relative w-full bg-black text-white ${plain ? "h-[62vh] min-h-[380px]" : "h-[200vh]"}`}
    >
      <div
        ref={shellRef}
        className={`flex w-full items-center justify-center overflow-hidden ${
          plain ? "h-full" : "sticky top-0 h-[100dvh]"
        }`}
      >
        {/*
          The set around the screen: cabinet, chin, feet. Cinema only — the plain band is a picture
          in a page, and a television built around it would be the "vẽ và đổi frame" it exists to
          avoid. The dial goes with it, so the plain band grows its own pause button below.
        */}
        {!plain && (
          <>
            {/*
          The set around the screen: cabinet, chin, feet.

          A sibling of the screen rather than a child of it, and that is forced rather than chosen —
          `clip-path` on the screen cuts everything inside it to the tube face, so a bezel drawn in
          there would be sliced away exactly where it is supposed to be widest.

          It overlays the screen's own box (same size, same rise) and draws every part *outward*
          from it with negative offsets, so nothing here has to re-derive the screen's geometry; it
          reads the same three custom properties the screen does.

          Inert to the pointer as a whole, so the title and the scroll button underneath stay
          clickable through the cabinet, and the one real control switches itself back on. Not
          `aria-hidden` either, for the same reason — that would take the button out of the
          accessibility tree with no way to put it back, so the decorative parts carry it instead.
        */}
            <div
              style={{
                width: "var(--screen-w, 58.1vw)",
                height: "var(--screen-h, 37.2vw)",
                transform: "translate(-50%, -50%) translateY(var(--screen-rise, -40px))",
                opacity: "var(--tv-opacity, 1)",
              }}
              className="pointer-events-none absolute left-1/2 top-1/2 z-0"
            >
              {/*
            The cabinet. Sits behind the glass and pokes out past it on every side — thin at the
            top and flanks, deep at the bottom, which is the proportion that reads as a television.
            The inset shadows are the moulding: a light line along the top of the plastic, a dark
            one along the bottom, and a hard black ring where the case meets the tube.
          */}
              <div
                style={{
                  top: "calc(-1 * var(--tv-bezel, 0px))",
                  left: "calc(-1 * var(--tv-bezel, 0px))",
                  right: "calc(-1 * var(--tv-bezel, 0px))",
                  bottom: "calc(-1 * var(--tv-chin, 0px))",
                  borderRadius: `calc(22px * var(--tv-k, 1))`,
                  background:
                    "linear-gradient(158deg, #4a4741 0%, #322f2b 34%, #24221f 62%, #171614 100%)",
                  boxShadow: `
                inset 0 calc(1.5px * var(--tv-k, 1)) 0 rgba(255,255,255,0.16),
                inset 0 calc(-2px * var(--tv-k, 1)) 0 rgba(0,0,0,0.55),
                inset 0 0 calc(24px * var(--tv-k, 1)) rgba(0,0,0,0.45),
                0 calc(26px * var(--tv-k, 1)) calc(48px * var(--tv-k, 1)) rgba(0,0,0,0.6)
              `,
                }}
                className="absolute -z-10"
              >
                {/* Chin furniture: maker's plate, speaker grille, tuning dials, power lamp. */}
                <div
                  style={{
                    height: "var(--tv-chin, 0px)",
                    paddingInline: `calc(var(--tv-chin, 0px) * 0.31)`,
                    gap: `calc(var(--tv-chin, 0px) * 0.24)`,
                  }}
                  className="absolute inset-x-0 bottom-0 flex items-center"
                >
                  <span
                    aria-hidden
                    style={{
                      fontSize: `calc(var(--tv-chin, 0px) * 0.175)`,
                      letterSpacing: `calc(var(--tv-chin, 0px) * 0.044)`,
                      color: "rgba(226,222,212,0.5)",
                      textShadow: "0 1px 0 rgba(0,0,0,0.8)",
                    }}
                    className="shrink-0 font-display font-black uppercase"
                  >
                    TixHub
                  </span>

                  {/*
                Speaker grille, capped rather than filling the chin.

                Left to stretch across the whole width it stops reading as a speaker and starts
                reading as a progress bar, which is what the first pass looked like. Capped at five
                and a half chin-heights and centred in the space it is given, so there is bare
                plastic either side of it the way there is on a real set.
              */}
                  <div
                    style={{
                      height: "58%",
                      maxWidth: `calc(var(--tv-chin, 0px) * 5.5)`,
                      borderRadius: `calc(3px * var(--tv-k, 1))`,
                      background:
                        "repeating-linear-gradient(to bottom, rgba(0,0,0,0.62) 0 calc(2px * var(--tv-k, 1)), rgba(255,255,255,0.07) calc(2px * var(--tv-k, 1)) calc(4px * var(--tv-k, 1)))",
                      boxShadow: "inset 0 0 6px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)",
                    }}
                    className="mx-auto min-w-0 flex-1"
                  />

                  {/*
                Two dials, and the size gap between them is the point: on a set of this vintage the
                big one is the tuner and the small one the volume, so equal circles would look like
                a control panel rather than a television.

                The big one is the only live control on the set — it stops and starts the trailer.
                It carries a glyph instead of the smaller dial's pointer notch, because a notch says
                "this turns" and nothing more, and a control that does something has to say what.

                `pointer-events-auto` against the wrapper's `none`, and `--tv-events` on top of it:
                the cabinet fades out under the scroll, and a button at `opacity: 0` still takes
                clicks. Without switching it off as it goes, an invisible hit target would sit over
                the opened video. Same treatment the title gets, for the same reason.
              */}
                  <button
                    type="button"
                    onClick={togglePlayback}
                    aria-label={paused ? "Phát trailer" : "Tạm dừng trailer"}
                    title={paused ? "Phát trailer" : "Tạm dừng trailer"}
                    style={{
                      width: `calc(var(--tv-chin, 0px) * 0.62)`,
                      height: `calc(var(--tv-chin, 0px) * 0.62)`,
                      background:
                        "radial-gradient(circle at 34% 28%, #6d6862 0%, #3c3934 46%, #1b1a18 100%)",
                      boxShadow: `
                      inset 0 calc(1px * var(--tv-k, 1)) 0 rgba(255,255,255,0.22),
                      0 calc(2px * var(--tv-k, 1)) calc(4px * var(--tv-k, 1)) rgba(0,0,0,0.65)
                    `,
                      pointerEvents:
                        "var(--tv-events, auto)" as React.CSSProperties["pointerEvents"],
                    }}
                    className="grid shrink-0 place-items-center rounded-full text-white/60 transition hover:text-white active:translate-y-px"
                  >
                    {paused ? (
                      <Play
                        style={{ width: `calc(var(--tv-chin, 0px) * 0.26)`, height: "auto" }}
                        // Filled, because at this size an outline triangle is four hairlines and a hole.
                        fill="currentColor"
                        strokeWidth={0}
                      />
                    ) : (
                      <Pause
                        style={{ width: `calc(var(--tv-chin, 0px) * 0.26)`, height: "auto" }}
                        fill="currentColor"
                        strokeWidth={0}
                      />
                    )}
                  </button>

                  <div
                    style={{
                      width: `calc(var(--tv-chin, 0px) * 0.44)`,
                      height: `calc(var(--tv-chin, 0px) * 0.44)`,
                      background:
                        "radial-gradient(circle at 34% 28%, #6d6862 0%, #3c3934 46%, #1b1a18 100%)",
                      boxShadow: `
                      inset 0 calc(1px * var(--tv-k, 1)) 0 rgba(255,255,255,0.22),
                      0 calc(2px * var(--tv-k, 1)) calc(4px * var(--tv-k, 1)) rgba(0,0,0,0.65)
                    `,
                    }}
                    className="relative shrink-0 rounded-full"
                  >
                    {/* The pointer notch — what makes the disc read as something that turns. */}
                    <div
                      style={{
                        width: `calc(1.5px * var(--tv-k, 1))`,
                        height: "34%",
                        top: "12%",
                        background: "rgba(240,236,226,0.75)",
                      }}
                      className="absolute left-1/2 -translate-x-1/2 rounded-full"
                    />
                  </div>

                  <div
                    style={{
                      width: `calc(var(--tv-chin, 0px) * 0.13)`,
                      height: `calc(var(--tv-chin, 0px) * 0.13)`,
                      background: "#ff6a3d",
                      boxShadow: `0 0 calc(7px * var(--tv-k, 1)) rgba(255,106,61,0.9)`,
                    }}
                    className="shrink-0 rounded-full"
                  />
                </div>
              </div>

              {/* Feet. Splayed slightly, so the box is standing on something rather than floating. */}
              {[-1, 1].map((side) => (
                <div
                  key={side}
                  style={{
                    width: `calc(var(--tv-chin, 0px) * 0.5)`,
                    height: "var(--tv-foot, 0px)",
                    bottom: "calc(-1 * (var(--tv-chin, 0px) + var(--tv-foot, 0px)))",
                    left: side < 0 ? "12%" : undefined,
                    right: side > 0 ? "12%" : undefined,
                    borderRadius: `0 0 calc(4px * var(--tv-k, 1)) calc(4px * var(--tv-k, 1))`,
                    background: "linear-gradient(to bottom, #26241f, #100f0e)",
                  }}
                  className="absolute -z-10"
                />
              ))}
            </div>
          </>
        )}

        {/*
          The screen itself. Width, height and corner radius are driven from the scroll handler as
          custom properties, so this element is the only thing that changes and React never
          re-renders to make it happen. It starts as a set across the room and ends as the window.
        */}
        <div
          ref={stageRef}
          style={
            plain
              ? undefined
              : {
                  width: "var(--screen-w, 58.1vw)",
                  height: "var(--screen-h, 37.2vw)",
                  transform: "translateY(var(--screen-rise, -40px))",
                }
          }
          // No drop shadow: `clip-path` clips an element's shadow along with its box, so one here
          // would be cut away the moment the path is applied rather than tracing the tube face.
          // `z-[1]` to keep the picture in front of the cabinet, which is at `z-0` behind it.
          className={`relative z-[1] overflow-hidden bg-black ${plain ? "h-full w-full" : ""}`}
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
            onPlay={() => {
              setShowPoster(false);
              setPaused(false);
            }}
            onPause={() => setPaused(true)}
          >
            <source src={movie.trailerUrl} />
          </video>

          <div className="absolute inset-0 z-[3] bg-black/35" />
          <div className="absolute inset-0 z-[3] bg-gradient-to-t from-black/75 via-black/20 to-black/20" />

          {/*
            The glass. Scanlines, a corner glare and a vignette darkening into the bow — the three
            things that separate a picture in a box from a picture on a tube. Cinema only, with the
            cabinet: scanlines over a picture with no television around it are just noise.

            These do belong inside the screen, unlike the cabinet: `clip-path` cutting them to the
            tube face is exactly right, since they are meant to stop where the glass does. They ride
            the same fade as the rest of the set, so the picture is clean long before full bleed.
          */}
          {!plain && (
            <div
              aria-hidden
              style={{ opacity: "var(--tv-opacity, 1)" }}
              className="pointer-events-none absolute inset-0 z-[4]"
            >
              <div
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, rgba(0,0,0,0.34) 0 1px, transparent 1px 3px)",
                }}
                className="absolute inset-0 opacity-45"
              />
              <div
                style={{
                  background:
                    "linear-gradient(114deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 20%, transparent 44%)",
                }}
                className="absolute inset-0"
              />
              <div
                style={{
                  background:
                    "radial-gradient(118% 108% at 50% 46%, transparent 52%, rgba(0,0,0,0.62) 100%)",
                }}
                className="absolute inset-0"
              />
            </div>
          )}
          {/*
            The plain band's own playback control.

            The cinema variant hides one inside the television's tuning dial; with no television
            there is nowhere to put it, and dropping it altogether would leave a video that autoplays
            with no way to stop it. Outlined on the picture, bottom right, where a player's controls
            already live.
          */}
          {plain && (
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={paused ? "Phát trailer" : "Tạm dừng trailer"}
              title={paused ? "Phát trailer" : "Tạm dừng trailer"}
              className="absolute bottom-5 right-5 z-[5] grid h-11 w-11 place-items-center border border-white/45 bg-black/30 text-white/85 backdrop-blur-sm transition hover:border-white hover:text-white"
            >
              {paused ? (
                <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />
              ) : (
                <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
              )}
            </button>
          )}
        </div>

        {/*
          The type sits above the screen at every size, so the layout does not change when the
          screen grows past it — only the opacity does.

          The offsets below are tuned to the cinema variant, where the title has a whole viewport to
          sit low in and a small screen to sit beside. The plain band is a third of that height, so
          the same numbers would push the heading straight out of the bottom of it; there it just
          sits at the foot of the picture.

          `--type-events` rather than a plain `pointer-events-auto`: the title is now the link into
          the event, and an element at `opacity: 0` still takes clicks. Without switching it off as
          it fades, the opened screen would carry an invisible hit target across its middle.
        */}
        <div
          ref={typeRef}
          className={`pointer-events-none absolute inset-0 z-10 flex px-5 sm:px-10 lg:px-[8%] ${
            plain ? "items-end pb-10" : "items-center pt-24"
          }`}
        >
          <div
            className={
              plain
                ? "max-w-[720px] lg:max-w-[880px]"
                : "max-w-[720px] translate-y-[156px] sm:-translate-x-[70px] sm:translate-y-[295px] lg:max-w-[880px]"
            }
          >
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
      </div>
    </section>
  );
}
