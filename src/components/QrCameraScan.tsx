/**
 * Camera QR scanning for organizer check-in (US6).
 *
 * Uses the native `BarcodeDetector` (Chrome/Edge/Android — the phones gate staff hold) with zero
 * dependencies: `getUserMedia` feeds a video element, a canvas hands each frame to the detector,
 * and a `requestAnimationFrame` loop drains it until one QR resolves. Browsers without
 * `BarcodeDetector` (Safari/Firefox) fall back to typing/pasting the code — the paste field also
 * accepts a USB/HID scanner, the other half of the gate-hardware story.
 */

import { useEffect, useRef, useState } from "react";

type DetectedBarcode = { rawValue: string };

interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
}

// TS 5.8's DOM lib predates the shape-detection API; declare only the slice we call.
const NativeDetector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

interface Props {
  onDetect: (code: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export default function QrCameraScan({ onDetect, onError, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const [state, setState] = useState<"idle" | "starting" | "scanning" | "denied">("idle");

  // Stop the camera whenever the component unmounts or the caller closes it.
  useEffect(
    () => () => {
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const stop = () => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setState("scanning");
      beginDetect();
    } catch {
      setState("denied");
      onError("Không truy cập được camera. Dán mã thủ công hoặc dùng máy quét USB.");
    }
  };

  const beginDetect = () => {
    if (!NativeDetector) {
      stop();
      onError("Trình duyệt không hỗ trợ quét camera. Dán mã thủ công.");
      return;
    }
    const detector = new NativeDetector({ formats: ["qr_code"] });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    runningRef.current = true;

    const tick = async () => {
      if (!runningRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        try {
          const codes = await detector.detect(canvas);
          if (codes.length) {
            runningRef.current = false;
            onDetect(codes[0].rawValue);
            return;
          }
        } catch {
          // A frame decode miss is not an error — keep sampling.
        }
      }
      requestAnimationFrame(tick);
    };
    void tick();
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border-2 border-beige-kem p-4">
      {state === "idle" && (
        <button type="button" onClick={() => void start()} className="rounded-xl bg-burgundy px-4 py-2.5 text-body font-black text-white transition hover:brightness-95">
          Quét bằng camera
        </button>
      )}

      {(state === "starting" || state === "scanning") && (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full max-w-xs rounded-xl border border-beige-kem/40 bg-black"
          />
          <p className="font-meta text-meta text-beige-kem/60">
            {state === "starting" ? "Đang mở camera…" : "Đưa mã QR vào khung để quét."}
          </p>
          <button type="button" onClick={stop} className="rounded-xl border-2 border-beige-kem px-3 py-2 text-eyebrow font-bold text-beige-kem/80 transition">
            Dừng
          </button>
        </>
      )}

      {state !== "idle" && (
        <button type="button" onClick={onClose} className="ml-2 font-meta text-meta text-ink-soft transition hover:text-beige-kem">
          Đóng camera
        </button>
      )}
    </div>
  );
}
