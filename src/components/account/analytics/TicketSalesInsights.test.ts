// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TimeSeriesSalesPoint } from "../../../../shared/types/analytics";
import { TicketSalesInsights } from "./TicketSalesInsights";

function day(date: string, tickets: number, revenue = 0): TimeSeriesSalesPoint {
  return {
    date,
    label: date.slice(5).split("-").reverse().join("/"),
    current_tickets_sold: tickets,
    current_revenue_vnd: revenue,
    previous_tickets_sold: 999,
    previous_revenue_vnd: 999_000_000,
  };
}

function render(grossRevenue: number, tickets: number, timeSeries: TimeSeriesSalesPoint[]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(TicketSalesInsights, {
      overview: { gross_revenue_vnd: grossRevenue, total_tickets_sold: tickets },
      timeSeries,
    }),
  );
  const value = (label: string) =>
    Array.from(container.querySelectorAll("dt")).find((dt) => dt.textContent === label)
      ?.nextElementSibling?.textContent;
  return { container, value, text: container.textContent ?? "" };
}

describe("TicketSalesInsights", () => {
  it("summarizes current-period ticket sales, including days with no sales", () => {
    const result = render(1_200_000, 6, [
      day("2026-08-25", 2, 900_000),
      day("2026-08-26", 0),
      day("2026-08-27", 4, 300_000),
    ]);
    expect(result.value("Doanh thu bình quân / vé")).toMatch(/200\.000\s*₫/);
    // Peak is by tickets, not by revenue or the previous period.
    expect(result.value("Ngày bán nhiều vé nhất")).toBe("27/08/2026");
    expect(result.container.querySelector("time")?.dateTime).toBe("2026-08-27");
    expect(result.text).toContain("4 vé đã bán");
    expect(result.value("Ngày có lượt bán")).toBe("2");
    expect(result.text).toContain("Trên 3 ngày trong kỳ");
    expect(result.text).not.toContain("Sức chứa suất gần nhất");
  });

  it("shows an honest empty state without dividing by zero", () => {
    for (const series of [[], [day("2026-08-27", 0)]]) {
      const result = render(0, 0, series);
      expect(result.text).toContain("Chưa có vé bán trong kỳ này");
      expect(result.text).not.toMatch(/NaN|Infinity/);
      expect(result.container.querySelector("dl")).toBeNull();
    }
  });

  it("includes free tickets as sales, with zero average revenue", () => {
    const result = render(0, 3, [day("2026-08-27", 3)]);
    expect(result.value("Doanh thu bình quân / vé")).toMatch(/^0\s*₫$/);
    expect(result.value("Ngày có lượt bán")).toBe("1");
    expect(result.text).toContain("3 vé đã bán");
  });

  it("uses the earliest peak date on ties and discloses the other peak days", () => {
    const result = render(1_000_000, 10, [day("2026-08-27", 5), day("2026-08-26", 5)]);
    expect(result.value("Ngày bán nhiều vé nhất")).toBe("26/08/2026");
    expect(result.text).toContain("Cùng mức cao nhất với 1 ngày khác.");
  });

  it("does not fabricate daily metrics if only totals are available", () => {
    const result = render(200_000, 2, []);
    expect(result.value("Doanh thu bình quân / vé")).toMatch(/100\.000\s*₫/);
    expect(result.value("Ngày bán nhiều vé nhất")).toBe("—");
    expect(result.value("Ngày có lượt bán")).toBe("—");
  });

  it("uses the newly supplied filtered report instead of accumulating old data", () => {
    render(1_000_000, 10, [day("2026-08-26", 10)]);
    const result = render(750_000, 3, [day("2026-08-27", 3)]);
    expect(result.value("Doanh thu bình quân / vé")).toMatch(/250\.000\s*₫/);
    expect(result.value("Ngày bán nhiều vé nhất")).toBe("27/08/2026");
    expect(result.text).toContain("3 vé đã bán");
    expect(result.value("Ngày có lượt bán")).toBe("1");
  });
});
