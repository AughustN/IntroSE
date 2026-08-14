import type { Request, Response, NextFunction } from "express";
import { getOrganizerAnalyticsService } from "./analyticsService.js";
import type { AnalyticsFilterParams } from "../../../../shared/types/analytics.js";
import { err } from "../../http.js";

export async function getOrganizerAnalyticsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw err.unauthorized("unauthorized", "Bạn chưa đăng nhập.");
    }

    const period = req.query.period as AnalyticsFilterParams["period"];
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const eventId = req.query.eventId as string;

    const data = await getOrganizerAnalyticsService(userId, {
      period: period || "7d",
      startDate,
      endDate,
      eventId,
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
