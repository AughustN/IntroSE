import { GoogleGenAI } from "@google/genai";
import { AI_TIMEOUT_MS, config } from "../../../config.js";

/**
 * The model seam (R-8).
 *
 * Exactly the shape `modules/auth/mailer.ts` uses for `ConsoleMailer`: a real implementation when a
 * key is configured, a fake otherwise. That is what lets the suite cover the timeout, error and
 * malformed-output branches deterministically without a network call — and it is also what makes the
 * constitutional claim testable, since the whole feature must work with the assistant switched off.
 *
 * The model produces PROSE ONLY. It is never asked for a price: that comes from SQL (R-6).
 */

export interface ListingDraft {
  titles: string[];
  description: string | null;
  tags: string[];
}

export interface ListingPrompt {
  topic: string;
  keywords: string[];
  categoryLabel?: string;
  city?: string;
}

export interface ListingModel {
  /** Rejects on timeout or upstream failure. Callers degrade; they never propagate the error. */
  draft(prompt: ListingPrompt, signal: AbortSignal): Promise<ListingDraft>;
}

function buildPrompt(p: ListingPrompt): string {
  return [
    "Bạn là trợ lý viết nội dung cho một nền tảng bán vé sự kiện tại Việt Nam.",
    "Viết bằng tiếng Việt, giọng văn tự nhiên, không phóng đại.",
    "",
    "QUY TẮC BẮT BUỘC:",
    "- Chỉ dùng thông tin người tổ chức cung cấp bên dưới.",
    "- KHÔNG bịa ngày, giờ, địa điểm, tên nghệ sĩ, sức chứa hay giá vé.",
    "- KHÔNG đề cập giá vé dưới bất kỳ hình thức nào.",
    "",
    `Chủ đề: ${p.topic}`,
    p.keywords.length ? `Từ khoá: ${p.keywords.join(", ")}` : "",
    p.categoryLabel ? `Danh mục: ${p.categoryLabel}` : "",
    p.city ? `Thành phố: ${p.city}` : "",
    "",
    "Trả về JSON thuần với đúng các khoá: titles (tối đa 3 chuỗi), description (một chuỗi), tags (tối đa 8 chuỗi).",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tolerant parse: the model may fence its JSON, and a malformed field is dropped downstream. */
function parseDraft(text: string): ListingDraft {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const parsed = JSON.parse(raw) as Partial<ListingDraft>;
  return {
    titles: Array.isArray(parsed.titles)
      ? parsed.titles.filter((t): t is string => typeof t === "string")
      : [],
    description: typeof parsed.description === "string" ? parsed.description : null,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === "string")
      : [],
  };
}

export class GeminiListingModel implements ListingModel {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async draft(prompt: ListingPrompt, signal: AbortSignal): Promise<ListingDraft> {
    const res = await this.client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: buildPrompt(prompt),
      config: { abortSignal: signal, responseMimeType: "application/json" },
    });
    return parseDraft(res.text ?? "");
  }
}

/** Deterministic stand-in. Also what runs when no key is configured, so the feature degrades. */
export class FakeListingModel implements ListingModel {
  constructor(private readonly behaviour: "ok" | "hang" | "throw" | "malformed" = "ok") {}

  async draft(prompt: ListingPrompt, signal: AbortSignal): Promise<ListingDraft> {
    if (this.behaviour === "throw") throw new Error("upstream failed");
    if (this.behaviour === "hang") {
      // Resolve only when the caller's timeout fires, so the timeout branch is exercised for real.
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    if (this.behaviour === "malformed") {
      return { titles: ["", "   "], description: "   ", tags: ["", " "] };
    }
    return {
      titles: [`${prompt.topic} — đêm nhạc đặc biệt`, `Trải nghiệm ${prompt.topic}`],
      description: `Một buổi ${prompt.topic} dành cho những ai yêu thích ${prompt.keywords[0] ?? "trải nghiệm mới"}.`,
      tags: prompt.keywords.slice(0, 4),
    };
  }
}

let override: ListingModel | null = null;

/** Test seam: swap the model for a fake with a chosen behaviour. */
export function setListingModelForTest(model: ListingModel | null): void {
  override = model;
}

/**
 * An empty `GEMINI_API_KEY` selects the fake, exactly as an empty `RESEND_API_KEY` selects
 * `ConsoleMailer`. Missing configuration degrades the assistant; it never fails a request.
 */
export function getListingModel(): ListingModel {
  if (override) return override;
  if (config.isTest || !config.geminiApiKey) return new FakeListingModel("ok");
  return new GeminiListingModel(config.geminiApiKey);
}

export { AI_TIMEOUT_MS };
