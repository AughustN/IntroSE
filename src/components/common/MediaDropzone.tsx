import React, { useState, useEffect, useRef } from "react";
import { X, PlayCircle, Image as ImageIcon, AlertCircle } from "lucide-react";
import { MediaType } from "../../types";

interface MediaDropzoneProps {
  label: string;
  mediaType: MediaType;
  currentUrl?: string | null;
  onFileSelected: (file: File | null) => void;
  onRemove?: () => void;
  accept?: string;
  maxSizeMb?: number;
  disabled?: boolean;
  required?: boolean;
  helpText?: string;
  /**
   * Move the caption INSIDE the drop target instead of across the label row.
   *
   * The create-event form wants the top-right help text ("Tỷ lệ 16:9"); the chart editor's
   * floor-plan and reference panels want the reading to live where the uploading happens — the
   * design shows the caption as the drop target's only content, and the panel's own heading above
   * already names the field, so the label row is omitted there (the drop target keeps an aria-label).
   */
  captionInside?: boolean;
  aspectRatio?: "square" | "video" | "banner" | "auto";
  /**
   * Cap the drop target's height.
   *
   * A 16:9 zone at full form width is ~375px tall, and two of them ate about a third of the
   * create-event form's scroll for two upload targets. Opt-in rather than the default, because the
   * chart editor's panels want the large preview — there the image IS the work.
   */
  compact?: boolean;
}

export const MediaDropzone: React.FC<MediaDropzoneProps> = ({
  label,
  mediaType,
  currentUrl,
  onFileSelected,
  onRemove,
  accept,
  maxSizeMb,
  disabled = false,
  required = false,
  helpText,
  aspectRatio = "auto",
  compact = false,
  captionInside = false,
}) => {
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVideo = mediaType === "trailer";
  const defaultMaxSize = isVideo ? 50 : mediaType === "avatar" || mediaType === "logo" ? 2 : 5;
  const effectiveMaxSize = maxSizeMb ?? defaultMaxSize;
  const defaultAccept = isVideo
    ? "video/mp4,video/webm"
    : "image/jpeg,image/png,image/webp,image/svg+xml";
  const effectiveAccept = accept ?? defaultAccept;

  // Clean up Object URL on unmount or file change
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFile = (file: File | null) => {
    setErrorMessage(null);

    if (!file) {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
      setStagedFile(null);
      setPreviewUrl(null);
      onFileSelected(null);
      return;
    }

    // Size limit check
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > effectiveMaxSize) {
      setErrorMessage(
        `Kích thước tệp quá lớn (${sizeMb.toFixed(1)}MB). Tối đa ${effectiveMaxSize}MB.`,
      );
      return;
    }

    // MIME type check
    if (isVideo && !file.type.startsWith("video/")) {
      setErrorMessage("Định dạng không hợp lệ. Vui lòng chọn tệp video (MP4, WebM).");
      return;
    }
    if (!isVideo && !file.type.startsWith("image/")) {
      setErrorMessage("Định dạng không hợp lệ. Vui lòng chọn tệp hình ảnh (JPEG, PNG, WebP, SVG).");
      return;
    }

    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setStagedFile(file);
    setPreviewUrl(objectUrl);
    onFileSelected(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    handleFile(null);
    if (onRemove) {
      onRemove();
    }
  };

  const activeDisplayUrl = previewUrl || currentUrl;

  const getAspectClass = () => {
    // `max-h` with the aspect ratio still set: wide containers stop growing taller, narrow ones
    // (a phone) keep the ratio and never end up a letterbox slot too short to drop a file into.
    const cap = compact ? " max-h-[180px]" : "";
    switch (aspectRatio) {
      case "square":
        return "aspect-square max-w-[200px]";
      case "video":
        return "aspect-video w-full" + cap;
      case "banner":
        return "aspect-[16/9] w-full" + cap;
      default:
        return (isVideo ? "aspect-video w-full" : "min-h-[160px] w-full") + cap;
    }
  };

  return (
    <div className="space-y-1.5">
      {!captionInside && (
        <div className="flex items-center justify-between">
          <label className="font-meta text-xs font-semibold uppercase tracking-wider text-beige-kem">
            {label} {required && <span className="text-burgundy">*</span>}
          </label>
          {helpText && <span className="font-meta text-[11px] text-ink-soft">{helpText}</span>}
        </div>
      )}

      <div
        aria-label={captionInside ? label : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`relative overflow-hidden border transition-all cursor-pointer flex flex-col items-center justify-center p-4 text-center ${getAspectClass()} ${
          isDragOver
            ? "border-burgundy bg-burgundy/10 scale-[1.01]"
            : activeDisplayUrl
              ? "border-beige-kem/30 bg-surface-2 hover:border-beige-kem/60"
              : "border-dashed border-beige-kem/35 bg-surface-2 hover:border-burgundy/60"
        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={effectiveAccept}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              handleFile(files[0]);
            }
          }}
          disabled={disabled}
          className="hidden"
        />

        {activeDisplayUrl ? (
          <div className="relative w-full h-full flex items-center justify-center group">
            {isVideo ? (
              <video
                src={activeDisplayUrl}
                controls
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <img
                src={activeDisplayUrl}
                alt={label}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            )}

            {!disabled && (
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="rounded-lg border border-beige-kem/40 bg-surface-2 px-3 py-1.5 text-xs font-medium text-beige-kem transition-colors hover:bg-beige-kem/10"
                >
                  Thay đổi
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-lg border border-burgundy/60 bg-burgundy/15 p-1.5 text-burgundy transition-colors hover:bg-burgundy/25"
                  title="Xóa tệp"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {stagedFile && (
              <div className="absolute left-2 top-2 rounded bg-cam-dat px-2 py-0.5 text-[10px] font-bold text-on-tint shadow">
                Chưa tải lên
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-ink-soft">
            {!captionInside &&
              (isVideo ? (
                <PlayCircle className="h-[26px] w-[26px] text-ink-soft" />
              ) : (
                <ImageIcon className="h-[26px] w-[26px] text-ink-soft" />
              ))}
            <div className="space-y-0.5">
              <p className="font-meta text-xs font-bold text-beige-kem">
                {captionInside
                  ? label
                  : isVideo
                    ? "Kéo thả video vào đây hoặc bấm để chọn"
                    : "Kéo thả ảnh vào đây hoặc bấm để chọn"}
              </p>
              {!captionInside && (
                <p className="font-meta text-[11px] text-ink-soft">
                  {isVideo ? "MP4, WebM" : "JPG, PNG, WEBP, SVG"} · Tối đa {effectiveMaxSize}MB
                </p>
              )}
              {captionInside && helpText && (
                <p className="font-meta text-[11px] text-ink-soft">{helpText}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mt-1 flex items-center gap-1.5 font-meta text-xs text-burgundy">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
