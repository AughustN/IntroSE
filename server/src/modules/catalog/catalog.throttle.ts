import { createSlidingRateLimiter } from "../../middleware/rateLimit.js";

/** One policy for public catalog + concessions. Attach only to matched routes, never `/api`. */
export const catalogRateLimit = createSlidingRateLimiter("catalog:ip", {
  windowMs: 60_000,
  max: 60,
  errorMessage: "Quá nhiều yêu cầu tải danh mục. Vui lòng thử lại sau giây lát.",
  headers: true,
});
