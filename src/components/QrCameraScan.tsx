/**
 * Camera QR scanning for organizer check-in (US6).
 *
 * `jsQR` decodes camera frames in JavaScript, so this works in browsers that
 * do not expose the experimental native `BarcodeDetector` API (notably iOS
 * Safari and Firefox).
 */

// @ts-ignore
import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

interface Props {
  onDetect: (code: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export default function QrCameraScan({ onDetect, onError, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const [state, setState] = useState<"idle" | "starting" | "scanning" | "denied">("idle");

  const stop = () => {
    runningRef.current = false;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  };

  // Stop the camera whenever the component unmounts or the caller closes it.
  useEffect(
    () => () => {
      runningRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const beginDetect = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      stop();
      onError("Không thể đọc hình ảnh từ camera. Dán mã thủ công hoặc dùng máy quét USB.");
      return;
    }
    runningRef.current = true;

    const tick = () => {
      if (!runningRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "attemptBoth",
        });
        if (result) {
          runningRef.current = false;
          onDetect(result.data);
          return;
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("denied");
      onError("Trình duyệt không hỗ trợ camera. Dán mã thủ công hoặc dùng máy quét USB.");
      return;
    }

    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;

      // The video element is always mounted, including while the start button is visible.
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setState("scanning");
      beginDetect();
    } catch {
      stop();
      setState("denied");
      onError(
        "Không truy cập được camera. Hãy cấp quyền camera, hoặc dán mã thủ công / dùng máy quét USB.",
      );
    }
  };

  const active = state === "starting" || state === "scanning";

  return (
    <div className="mt-3 space-y-3 rounded-xl border-2 border-beige-kem p-4">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={
          active
            ? "aspect-video w-full max-w-xs rounded-xl border border-beige-kem/40 bg-black object-cover"
            : "hidden"
        }
      />

      {state === "idle" || state === "denied" ? (
        <button
          type="button"
          onClick={() => void start()}
          className="rounded-xl bg-burgundy px-4 py-2.5 text-body font-black text-white transition hover:brightness-95"
        >
          Quét bằng camera
        </button>
      ) : (
        <>
          <p className="font-meta text-meta text-beige-kem/60">
            {state === "starting" ? "Đang mở camera..." : "Đưa mã QR vào khung để quét."}
          </p>
          <button
            type="button"
            onClick={stop}
            className="rounded-xl border-2 border-beige-kem px-3 py-2 text-eyebrow font-bold text-beige-kem/80 transition"
          >
            Dừng
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          stop();
          onClose();
        }}
        className="ml-2 font-meta text-meta text-ink-soft transition hover:text-beige-kem"
      >
        Đóng camera
      </button>
    </div>
  );
}
