import React, { useState, useEffect, useRef } from 'react';
import { Upload, X, Film, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { MediaType } from '../../types';

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
  aspectRatio?: 'square' | 'video' | 'banner' | 'auto';
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
  aspectRatio = 'auto',
}) => {
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVideo = mediaType === 'trailer';
  const defaultMaxSize = isVideo ? 50 : mediaType === 'avatar' || mediaType === 'logo' ? 2 : 5;
  const effectiveMaxSize = maxSizeMb ?? defaultMaxSize;
  const defaultAccept = isVideo ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/svg+xml';
  const effectiveAccept = accept ?? defaultAccept;

  // Clean up Object URL on unmount or file change
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFile = (file: File | null) => {
    setErrorMessage(null);

    if (!file) {
      if (previewUrl && previewUrl.startsWith('blob:')) {
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
      setErrorMessage(`Kích thước tệp quá lớn (${sizeMb.toFixed(1)}MB). Tối đa ${effectiveMaxSize}MB.`);
      return;
    }

    // MIME type check
    if (isVideo && !file.type.startsWith('video/')) {
      setErrorMessage('Định dạng không hợp lệ. Vui lòng chọn tệp video (MP4, WebM).');
      return;
    }
    if (!isVideo && !file.type.startsWith('image/')) {
      setErrorMessage('Định dạng không hợp lệ. Vui lòng chọn tệp hình ảnh (JPEG, PNG, WebP, SVG).');
      return;
    }

    if (previewUrl && previewUrl.startsWith('blob:')) {
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
      fileInputRef.current.value = '';
    }
    handleFile(null);
    if (onRemove) {
      onRemove();
    }
  };

  const activeDisplayUrl = previewUrl || currentUrl;

  const getAspectClass = () => {
    switch (aspectRatio) {
      case 'square':
        return 'aspect-square max-w-[200px]';
      case 'video':
        return 'aspect-video w-full';
      case 'banner':
        return 'aspect-[16/9] w-full';
      default:
        return isVideo ? 'aspect-video w-full' : 'min-h-[160px] w-full';
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-stone-300 uppercase tracking-wider">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        {helpText && <span className="text-[11px] text-stone-500">{helpText}</span>}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`relative overflow-hidden rounded-xl border transition-all cursor-pointer flex flex-col items-center justify-center p-4 text-center ${getAspectClass()} ${
          isDragOver
            ? 'border-amber-500 bg-amber-500/10 scale-[1.01]'
            : activeDisplayUrl
            ? 'border-stone-700 bg-stone-900/90 hover:border-stone-500'
            : 'border-dashed border-stone-700 bg-stone-900/40 hover:bg-stone-900/70 hover:border-amber-500/60'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                  className="px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg border border-stone-600 transition-colors"
                >
                  Thay đổi
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1.5 text-red-400 hover:text-red-300 bg-red-950/60 hover:bg-red-900/60 rounded-lg border border-red-800 transition-colors"
                  title="Xóa tệp"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {stagedFile && (
              <div className="absolute top-2 left-2 bg-amber-500/90 text-stone-950 font-bold text-[10px] px-2 py-0.5 rounded shadow">
                Chưa tải lên
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2 text-stone-400">
            <div className="p-3 bg-stone-800/80 rounded-full text-stone-300 border border-stone-700">
              {isVideo ? <Film className="w-6 h-6 text-amber-400" /> : <Upload className="w-6 h-6 text-amber-400" />}
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-stone-200">
                <span className="text-amber-400 font-semibold">Nhấn để tải lên</span> hoặc kéo thả vào đây
              </p>
              <p className="text-[11px] text-stone-500">
                {isVideo ? 'MP4, WebM' : 'PNG, JPG, WebP, SVG'} (Tối đa {effectiveMaxSize}MB)
              </p>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
