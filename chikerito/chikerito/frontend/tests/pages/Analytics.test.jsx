import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Analytics from "../../src/pages/Analytics.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));
vi.mock("../../src/analyticsUtils.js", async (load) => {
  const actual = await load();
  return { ...actual, downloadAnalyticsCsv: vi.fn() };
});

const analytics = {
  filters: { from: null, to: null, categoryId: null, comparison: "none" }, currency: "USD",
  summary: { spent: 350, raised: 500, net: 150, budget: 1000, variance: 650, expenseCount: 3, contributionCount: 2, averageExpense: 116.67, largestExpense: 200, largestContribution: 300, uncategorizedSpent: 25, durationDays: null, dailyAverageSpent: null },
  comparison: null,
  categoryBreakdown: [
    { id: "cat-a", name: "Venue", budget: 700, spent: 300, raised: 400, variance: 400, utilization: 42.9 },
    { id: "cat-b", name: "Music", budget: 300, spent: 50, raised: 100, variance: 250, utilization: 16.7 },
  ],
  monthlyTrend: [{ month: "2026-03", total: 100 }, { month: "2026-04", total: 250 }],
  statusBreakdown: [{ status: "paid", count: 3 }],
  topVendors: [{ vendor: "Acme Events", total: 200, count: 2 }, { vendor: "DJ Co", total: 50, count: 1 }],
  insights: [{ type: "warning", code: "categories_over_budget", message: "One category is over budget." }],
};

function renderPage() { return render(<MemoryRouter><Analytics /></MemoryRouter>); }

describe("Analytics v2", () => {
  beforeEach(() => {
    useLifeSpace.mockReturnValue({ currentId: "space-1", current: { id: "space-1", title: "Wedding", currency: "USD" }, lifeSpaces: [], selectLifeSpace: vi.fn() });
    api.getAnalytics.mockResolvedValue({ analytics });
    api.listCategories.mockResolvedValue({ categories: [{ id: "cat-a", name: "Venue" }, { id: "cat-b", name: "Music" }] });
  });

  it("shows the no-life-space state", () => {
    useLifeSpace.mockReturnValue({ currentId: null, current: null, lifeSpaces: [], selectLifeSpace: vi.fn() }); renderPage();
    expect(screen.getByText(/create a life space to see analytics/i)).toBeInTheDocument();
    expect(api.getAnalytics).not.toHaveBeenCalled();
  });

  it("shows loading while requests are pending", () => {
    api.getAnalytics.mockReturnValue(new Promise(() => {})); api.listCategories.mockReturnValue(new Promise(() => {})); renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/loading analytics/i);
  });

  it("loads analytics and categories for the selected life space", async () => {
    renderPage(); await screen.findByText("Financial Analytics");
    expect(api.getAnalytics).toHaveBeenCalledWith("space-1", { from: "", to: "", categoryId: "", comparison: "none" });
    expect(api.listCategories).toHaveBeenCalledWith("space-1");
    expect(await screen.findByRole("option", { name: "Venue" })).toBeInTheDocument();
  });

  it("renders all headline metrics", async () => {
    renderPage();
    expect(await screen.findByText("$350.00")).toBeInTheDocument(); expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument(); expect(screen.getByText("$650.00")).toBeInTheDocument(); expect(screen.getByText("$116.67")).toBeInTheDocument();
  });

  it("renders period activity details", async () => {
    renderPage(); const summary = await screen.findByRole("region", { name: /period activity summary/i });
    expect(summary).toHaveTextContent("Expenses3"); expect(summary).toHaveTextContent("Contributions2"); expect(summary).toHaveTextContent("Largest expense$200.00"); expect(summary).toHaveTextContent("Uncategorized spend$25.00");
  });

  it("renders a daily average for bounded responses", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, summary: { ...analytics.summary, durationDays: 31, dailyAverageSpent: 11.29 } } }); renderPage();
    expect(await screen.findByText("Days in period")).toBeInTheDocument(); expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByText("Daily average")).toBeInTheDocument(); expect(screen.getByText("$11.29")).toBeInTheDocument();
  });

  it("renders category performance", async () => {
    renderPage(); expect(await screen.findByText("Category performance")).toBeInTheDocument();
    expect(screen.getAllByText("Venue").length).toBeGreaterThan(0); expect(screen.getAllByText("42.9%").length).toBeGreaterThan(0);
  });

  it("renders top vendors and counts", async () => {
    renderPage(); expect(await screen.findByText("Acme Events")).toBeInTheDocument(); expect(screen.getByText("DJ Co")).toBeInTheDocument();
  });

  it("renders server-provided insights", async () => {
    renderPage(); expect(await screen.findByRole("region", { name: /analytics insights/i })).toHaveTextContent("One category is over budget.");
  });

  it("renders deterministic expense status counts", async () => {
    renderPage(); expect(await screen.findByText("Expense status")).toBeInTheDocument(); expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("shows an empty expense-status state", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, statusBreakdown: [] } }); renderPage();
    expect(await screen.findByText(/no expense statuses in this period/i)).toBeInTheDocument();
  });

  it("uses the life-space currency", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, currency: "KES" } }); renderPage();
    expect(await screen.findByText(/KES\s*350/)).toBeInTheDocument();
  });

  it("shows request errors and a retry action", async () => {
    api.getAnalytics.mockRejectedValueOnce(new Error("Analytics unavailable")); renderPage();
    expect(await screen.findByText("Analytics unavailable")).toBeInTheDocument(); expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    api.getAnalytics.mockRejectedValueOnce(new Error("Temporary")).mockResolvedValueOnce({ analytics }); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(api.getAnalytics).toHaveBeenCalledTimes(2)); expect(await screen.findByText("$350.00")).toBeInTheDocument();
  });

  it("shows an activity empty state", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, summary: { ...analytics.summary, expenseCount: 0, contributionCount: 0 }, categoryBreakdown: [], monthlyTrend: [], topVendors: [] } });
    renderPage(); expect(await screen.findByText(/no activity in this period/i)).toBeInTheDocument();
  });

  it("shows empty category and vendor tables", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, categoryBreakdown: [], topVendors: [] } }); renderPage();
    expect(await screen.findByText(/no categories match/i)).toBeInTheDocument(); expect(screen.getByText(/no vendors match/i)).toBeInTheDocument();
  });

  it("shows an empty monthly-trend message", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, monthlyTrend: [] } }); renderPage();
    expect(await screen.findByText(/no expense history in this period/i)).toBeInTheDocument();
  });

  it("does not apply draft filters before submission", async () => {
    renderPage(); await screen.findByText("$350.00"); fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } });
    expect(api.getAnalytics).toHaveBeenCalledTimes(1);
  });

  it("offers deterministic quick-range controls", async () => {
    renderPage(); await screen.findByText("$350.00");
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year to date" })).toBeInTheDocument();
  });

  it("shows the applied range label returned by the server", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, filters: { ...analytics.filters, from: "2026-04-01", to: "2026-04-30" } } });
    renderPage(); expect(await screen.findByText("2026-04-01 to 2026-04-30")).toBeInTheDocument();
  });

  it("fills this-month dates from the current UTC date", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-18T12:00:00Z")); renderPage();
    await vi.runAllTimersAsync(); fireEvent.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-08-01"); expect(screen.getByLabelText("To")).toHaveValue("2026-08-18"); vi.useRealTimers();
  });

  it("fills an inclusive last-30-days range", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-18T12:00:00Z")); renderPage();
    await vi.runAllTimersAsync(); fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-07-20"); expect(screen.getByLabelText("To")).toHaveValue("2026-08-18"); vi.useRealTimers();
  });

  it("fills a year-to-date range", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-18T12:00:00Z")); renderPage();
    await vi.runAllTimersAsync(); fireEvent.click(screen.getByRole("button", { name: "Year to date" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-01-01"); expect(screen.getByLabelText("To")).toHaveValue("2026-08-18"); vi.useRealTimers();
  });

  it("disables CSV export while loading", () => {
    api.getAnalytics.mockReturnValue(new Promise(() => {})); api.listCategories.mockReturnValue(new Promise(() => {})); renderPage();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });

  it("applies date filters", async () => {
    renderPage(); await screen.findByText("$350.00");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } }); fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-30" } });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));
    await waitFor(() => expect(api.getAnalytics).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ from: "2026-04-01", to: "2026-04-30" })));
  });

  it("applies a category filter", async () => {
    renderPage(); await screen.findByRole("option", { name: "Venue" }); fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat-a" } });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));
    await waitFor(() => expect(api.getAnalytics).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ categoryId: "cat-a" })));
  });

  it("requires both dates for previous-period comparison", async () => {
    renderPage(); await screen.findByText("$350.00"); fireEvent.change(screen.getByLabelText("Comparison"), { target: { value: "previous" } });
    expect(screen.getByText(/choose both dates/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /apply filters/i })).toBeDisabled();
  });

  it("applies previous-period comparison with a complete range", async () => {
    renderPage(); await screen.findByText("$350.00");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } }); fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-30" } }); fireEvent.change(screen.getByLabelText("Comparison"), { target: { value: "previous" } });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));
    await waitFor(() => expect(api.getAnalytics).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ comparison: "previous" })));
  });

  it("prevents a reversed date range", async () => {
    renderPage(); await screen.findByText("$350.00"); fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-05-01" } }); fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-01" } });
    expect(screen.getByText(/from date must be/i)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /apply filters/i })).toBeDisabled();
  });

  it("clears all draft and applied filters", async () => {
    renderPage(); await screen.findByText("$350.00"); fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } }); fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByLabelText("From")).toHaveValue(""); await waitFor(() => expect(api.getAnalytics).toHaveBeenLastCalledWith("space-1", { from: "", to: "", categoryId: "", comparison: "none" }));
  });

  it("renders positive, negative, zero, and new comparison labels", async () => {
    api.getAnalytics.mockResolvedValue({ analytics: { ...analytics, comparison: { changes: { spent: 25, raised: -10, net: 0, expenseCount: null } } } }); renderPage();
    expect(await screen.findByText("+25% vs previous period")).toBeInTheDocument(); expect(screen.getByText("-10% vs previous period")).toBeInTheDocument(); expect(screen.getByText("No change")).toBeInTheDocument();
  });

  it("reloads when the selected life space changes", async () => {
    const view = renderPage(); await screen.findByText("$350.00"); useLifeSpace.mockReturnValue({ currentId: "space-2", current: { id: "space-2", title: "Trip", currency: "USD" }, lifeSpaces: [], selectLifeSpace: vi.fn() });
    view.rerender(<MemoryRouter><Analytics /></MemoryRouter>); await waitFor(() => expect(api.getAnalytics).toHaveBeenCalledWith("space-2", expect.any(Object)));
  });
});
