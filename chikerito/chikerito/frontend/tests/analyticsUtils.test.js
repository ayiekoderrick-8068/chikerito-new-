import { describe, expect, it, vi } from "vitest";
import { analyticsCsv, changeLabel, csvEscape, formatMoney, downloadAnalyticsCsv } from "../src/analyticsUtils.js";

const data = {
  filters: { from: "2026-01-01", to: "2026-01-31" }, currency: "USD",
  summary: { spent: 100, raised: 250, net: 150, budget: 500, variance: 400, expenseCount: 2, averageExpense: 50 },
  categoryBreakdown: [{ name: "Venue, Hall", budget: 500, spent: 100, raised: 250, variance: 400, utilization: 20 }],
  monthlyTrend: [{ month: "2026-01", total: 100 }], topVendors: [{ vendor: 'A "Quoted" Vendor', total: 100, count: 2 }],
};

describe("analytics utilities", () => {
  it("formats money with the selected currency", () => { expect(formatMoney(1234.5, "USD")).toMatch(/1,234\.50/); expect(formatMoney(100, "KES")).toMatch(/KES/); });
  it("formats nullish money as zero", () => expect(formatMoney(undefined, "USD")).toMatch(/0/));
  it("labels a positive change", () => expect(changeLabel(12.5)).toBe("+12.5% vs previous period"));
  it("labels a negative change", () => expect(changeLabel(-8)).toBe("-8% vs previous period"));
  it("labels no change", () => expect(changeLabel(0)).toBe("No change"));
  it("labels a new metric", () => expect(changeLabel(null)).toBe("New in this period"));
  it("leaves plain CSV values unquoted", () => expect(csvEscape("Venue")).toBe("Venue"));
  it("quotes CSV commas", () => expect(csvEscape("Venue, Hall")).toBe('"Venue, Hall"'));
  it("escapes CSV quotes", () => expect(csvEscape('A "Vendor"')).toBe('"A ""Vendor"""'));
  it("quotes CSV newlines", () => expect(csvEscape("two\nlines")).toBe('"two\nlines"'));
  it("exports summary rows", () => { const csv = analyticsCsv(data); expect(csv).toContain("Spent,100"); expect(csv).toContain("Raised,250"); expect(csv).toContain("Variance,400"); });
  it("exports filter metadata", () => { const csv = analyticsCsv(data); expect(csv).toContain("From,2026-01-01"); expect(csv).toContain("To,2026-01-31"); });
  it("exports category rows safely", () => expect(analyticsCsv(data)).toContain('"Venue, Hall",500,100,250,400,20'));
  it("exports monthly trend rows", () => expect(analyticsCsv(data)).toContain("2026-01,100"));
  it("exports vendor rows safely", () => expect(analyticsCsv(data)).toContain('"A ""Quoted"" Vendor",100,2'));
  it("exports insight rows", () => expect(analyticsCsv({ ...data, insights: [{ code: "warning", message: "Review spending" }] })).toContain("warning,Review spending"));
  it("uses all-time labels without dates", () => expect(analyticsCsv({ ...data, filters: { from: null, to: null } })).toContain("From,All time"));
  it("downloads with a sanitized title", () => {
    const click = vi.fn(); const anchor = { click, set href(value) { this._href = value; }, set download(value) { this._download = value; } };
    vi.spyOn(document, "createElement").mockReturnValue(anchor); URL.createObjectURL = vi.fn(() => "blob:test"); URL.revokeObjectURL = vi.fn();
    downloadAnalyticsCsv(data, "Our Wedding 2026!");
    expect(anchor._download).toBe("our-wedding-2026-analytics.csv"); expect(anchor._href).toBe("blob:test"); expect(click).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
