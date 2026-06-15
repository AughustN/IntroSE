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

export default function HeroVideo({ movie, onBookNow }: HeroVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPoster, setShowPoster] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = isMuted;
    video.currentTime = 0;
    video.load();
    setShowPoster(true);

    const playPromise = video.play();
    if (playPromise) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          setShowPoster(false);
        })
        .catch(() => {
          setIsPlaying(false);
          setShowPoster(true);
        });
    }
  }, [movie.id, isMuted]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    video.play()
      .then(() => {
        setIsPlaying(true);
        setShowPoster(false);
      })
      .catch(() => {
        setIsPlaying(false);
        setShowPoster(true);
      });
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  return (
    <section
      id="hero-trailer-section"
      className="relative min-h-[100dvh] w-full overflow-hidden bg-black text-white"
    >
      <div className="absolute inset-0">
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
          playsInline
          preload="metadata"
          referrerPolicy="no-referrer"
          onPlay={() => {
            setIsPlaying(true);
            setShowPoster(false);
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setShowPoster(true);
          }}
        >
          <source src={movie.trailerUrl} />
        </video>
      </div>

      <div className="absolute inset-0 z-[3] bg-black/35" />
      <div className="absolute inset-0 z-[3] bg-gradient-to-t from-black/75 via-black/20 to-black/20" />

      <div className="relative z-10 flex min-h-[100dvh] items-center px-5 pt-24 sm:px-10 lg:px-[8%]">
        <div className="max-w-[720px] translate-y-6 space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">
            <span className="border border-white/60 px-2.5 py-1 text-white">{movie.ageRating}</span>
            <span>{movie.duration} phút</span>
            <span>{movie.genre.join(" / ")}</span>
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-5xl font-black uppercase leading-[0.9] tracking-normal text-white sm:text-7xl lg:text-8xl">
              {movie.title}
            </h1>
            {movie.originalTitle && (
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-white/65 sm:text-base">
                {movie.originalTitle}
              </p>
            )}
          </div>

          <p className="max-w-xl text-sm leading-7 text-white/78 sm:text-base">
            {movie.description}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              id="hero-book-now-btn"
              onClick={onBookNow}
              className="inline-flex items-center bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-black transition duration-200 hover:bg-[#ffc527] active:translate-y-px"
            >
              Đặt vé
            </button>

            <button
              id="hero-toggle-play-btn"
              onClick={togglePlay}
              className="inline-flex h-11 items-center justify-center border border-white/55 bg-black/20 px-4 text-xs font-bold uppercase text-white backdrop-blur-sm transition duration-200 hover:border-white hover:bg-white hover:text-black active:translate-y-px"
              title={isPlaying ? "Tạm dừng" : "Phát trailer"}
            >
              {isPlaying ? "Tạm dừng" : "Phát"}
            </button>

            <button
              id="hero-toggle-mute-btn"
              onClick={toggleMute}
              className="inline-flex h-11 items-center justify-center border border-white/55 bg-black/20 px-4 text-xs font-bold uppercase text-white backdrop-blur-sm transition duration-200 hover:border-white hover:bg-white hover:text-black active:translate-y-px"
              title={isMuted ? "Bật âm thanh" : "Tắt âm thanh"}
            >
              {isMuted ? "Bật âm" : "Tắt âm"}
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="absolute bottom-8 right-[8%] z-10 grid h-12 w-12 place-items-center border border-white/45 bg-black/20 text-white/85 backdrop-blur-sm transition duration-200 hover:translate-y-1 hover:border-white hover:text-white"
        onClick={() => window.scrollBy({ top: window.innerHeight - 80, behavior: "smooth" })}
        aria-label="Cuộn xuống"
        title="Cuộn xuống"
      >
        <ArrowDown className="h-5 w-5" />
      </button>
    </section>
  );
}
