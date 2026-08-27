/** Export the visible viewport, not a second drawing that might disagree with the live canvas. */
const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "color",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "visibility",
  "display",
];

export function snapshotSvg(source: SVGSVGElement): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  originals.forEach((original, index) => {
    const copy = copies[index];
    const computed = getComputedStyle(original);
    copy.removeAttribute("class");
    copy.removeAttribute("style");
    for (const property of STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value)
        copy.style.setProperty(
          property,
          value.replace(/url\(["']?[^)]*#([^"')]+)["']?\)/g, "url(#$1)"),
        );
    }
    // System fonts also render when the SVG is decoded as an image, outside the page's stylesheet.
    copy.style.fontFamily = "Arial, sans-serif";
  });
  clone.setAttribute("xmlns", SVG_NS);
  clone.style.removeProperty("display");
  return clone;
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không thể đọc ảnh nền sơ đồ."));
    reader.readAsDataURL(blob);
  });

export async function downloadSeatMapPng(
  source: SVGSVGElement,
  options: {
    fileName: string;
    title: string;
    subtitle: string;
    notes: string[];
    background: string;
    ink: string;
    signal: AbortSignal;
  },
): Promise<void> {
  // Clone synchronously: seat updates arriving during image loading cannot change this snapshot.
  const clone = snapshotSvg(source);
  const bounds = source.getBoundingClientRect();
  const width = 1800;
  const height = Math.min(
    1800,
    Math.max(500, Math.round((width * bounds.height) / Math.max(bounds.width, 1))),
  );
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  await Promise.all(
    Array.from(clone.querySelectorAll("image")).map(async (node) => {
      const href =
        node.getAttribute("href") ?? node.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href) return;
      // Embed the displayed background so the downloaded file is self-contained and canvas-safe.
      const response = await fetch(new URL(href, document.baseURI), { signal: options.signal });
      if (!response.ok) throw new Error("Không tải được ảnh nền để lưu sơ đồ. Vui lòng thử lại.");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Ảnh nền sơ đồ không hợp lệ.");
      node.setAttribute("href", await dataUrl(blob));
      node.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    }),
  );
  options.signal.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        image.src = "";
        reject(new Error("Đã dừng lưu ảnh."));
      };
      image.onload = () => {
        options.signal.removeEventListener("abort", abort);
        resolve();
      };
      image.onerror = () => {
        options.signal.removeEventListener("abort", abort);
        reject(new Error("Không thể dựng ảnh sơ đồ. Vui lòng thử lại."));
      };
      options.signal.addEventListener("abort", abort, { once: true });
      image.src = url;
    });
    options.signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    const header = 150;
    canvas.height = height + header + 50 + options.notes.length * 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ lưu ảnh sơ đồ.");
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = options.ink;
    context.font = "bold 32px Arial";
    context.fillText(options.title, 32, 48, width - 64);
    context.font = "24px Arial";
    context.fillText(options.subtitle, 32, 88, width - 64);
    context.fillText(
      "Ảnh chụp trạng thái tại thời điểm lưu · Không tự cập nhật",
      32,
      125,
      width - 64,
    );
    context.drawImage(image, 0, header, width, height);
    options.notes.forEach((note, index) =>
      context.fillText(note, 32, header + height + 34 + index * 32, width - 64),
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Không thể tạo tệp PNG."))),
        "image/png",
      ),
    );
    options.signal.throwIfAborted();
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = options.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
