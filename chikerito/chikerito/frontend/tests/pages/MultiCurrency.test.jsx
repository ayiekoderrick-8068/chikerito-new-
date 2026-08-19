import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExpenseTracker from "../../src/pages/ExpenseTracker.jsx";
import RecurringExpenses from "../../src/pages/RecurringExpenses.jsx";
import Contributions from "../../src/pages/Contributions.jsx";
import Dashboard from "../../src/pages/Dashboard.jsx";
import Settings from "../../src/pages/Settings.jsx";
import MilestoneReport from "../../src/components/MilestoneReport.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";
import { useAuth } from "../../src/context/AuthContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));
vi.mock("../../src/context/AuthContext.jsx", () => ({ useAuth: vi.fn() }));

const currencyMetadata = [
  { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", minorUnits: 2 },
];

function setSpace(overrides = {}) {
  const current = {
    id: "space-1",
    title: "Currency Wedding",
    role: "owner",
    currency: "USD",
    goal_amount: 10000,
    story: "",
    cover_image: null,
    visibility: "private",
    show_budget_public: false,
    allow_indexing: false,
    hasPasscode: false,
    slug: "currency-wedding",
    ...overrides,
  };
  useLifeSpace.mockReturnValue({ currentId: current.id, current, loading: false, lifeSpaces: [current], refresh: vi.fn(), selectLifeSpace: vi.fn() });
  return current;
}

function renderRoute(component) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSpace();
  useAuth.mockReturnValue({ user: { firstName: "Ada", lastName: "L", email: "ada@example.test" } });
  api.listCurrencies.mockResolvedValue({ currencies: currencyMetadata });
  api.listSessions.mockResolvedValue({ sessions: [] });
  api.listCategories.mockResolvedValue({ categories: [{ id: "cat-1", name: "Venue" }] });
});

describe("expense multi-currency experience", () => {
  it("keeps legacy expense rows in the Life Space base currency", async () => {
    setSpace({ currency: "KES" });
    api.listExpenses.mockResolvedValue({ expenses: [{ id: "e1", vendor: "Legacy Hall", amount: 2500, category_id: null, payment_date: "2026-01-01", status: "paid", receipt_url: null, created_at: "2026-01-01T00:00:00Z" }], hasMore: false });
    renderRoute(<ExpenseTracker />);
    expect(await screen.findByText("Legacy Hall")).toBeInTheDocument();
    expect(screen.getByText(/KSh|KES/)).toBeInTheDocument();
    expect(screen.queryByText(/at 1/)).not.toBeInTheDocument();
  });

  it("shows original foreign amount and normalized base context", async () => {
    api.listExpenses.mockResolvedValue({ expenses: [{
      id: "e2", vendor: "Paris Florist", amount: 100, category_id: null, payment_date: "2026-01-01", status: "paid", receipt_url: null, created_at: "2026-01-01T00:00:00Z",
      money: { originalAmount: 100, currency: "EUR", exchangeRate: 1.2, baseAmount: 120, baseCurrency: "USD", converted: true },
    }], hasMore: false });
    renderRoute(<ExpenseTracker />);
    await screen.findByText("Paris Florist");
    expect(screen.getByText(/EUR\s*100|100.*EUR/)).toBeInTheDocument();
    expect(screen.getByText(/USD.*120.*at 1\.2/)).toBeInTheDocument();
  });

  it("defaults the create selector to the base currency", async () => {
    setSpace({ currency: "KES" });
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    renderRoute(<ExpenseTracker />);
    await screen.findByText(/no expenses recorded/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    expect(screen.getByLabelText("Currency")).toHaveValue("KES");
    expect(screen.queryByLabelText(/exchange rate/i)).not.toBeInTheDocument();
  });

  it("does not expose an editable rate when foreign currency is selected", async () => {
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    renderRoute(<ExpenseTracker />);
    await screen.findByText(/no expenses recorded/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    expect(screen.queryByLabelText(/exchange rate/i)).not.toBeInTheDocument();
  });

  it("submits currency without a client-controlled rate", async () => {
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    api.createExpense.mockResolvedValue({ expense: {} });
    renderRoute(<ExpenseTracker />);
    await screen.findByText(/no expenses recorded/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    await userEvent.type(screen.getByLabelText("Vendor"), "Foreign Vendor");
    await userEvent.type(screen.getByLabelText(/Amount \(USD\)/), "10");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(() => expect(api.createExpense).toHaveBeenCalled());
    expect(api.createExpense.mock.calls[0][1]).toEqual(expect.objectContaining({ amount: "10", currency: "EUR" }));
    expect(api.createExpense.mock.calls[0][1]).not.toHaveProperty("exchangeRate");
  });

  it("hides transaction controls from read-only members", async () => {
    setSpace({ role: "volunteer", currency: "EUR" });
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    renderRoute(<ExpenseTracker />);
    await screen.findByText(/no expenses recorded/i);
    expect(screen.queryByRole("button", { name: /record expense/i })).not.toBeInTheDocument();
  });
});

describe("recurring and contribution currency controls", () => {
  beforeEach(() => {
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: [] });
    api.listContributions.mockResolvedValue({ contributions: [] });
  });

  it("defaults a recurring rule to the Life Space base currency", async () => {
    setSpace({ currency: "EUR" });
    renderRoute(<RecurringExpenses />);
    await screen.findByText(/no recurring expenses/i);
    await userEvent.click(screen.getByRole("button", { name: /add recurring expense/i }));
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
  });

  it("shows recurring converted context", async () => {
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: [{
      id: "r1", vendor: "London Storage", amount: 20, category_id: null, frequency: "monthly", status: "active", nextOccurrence: "2027-01-01",
      money: { originalAmount: 20, currency: "GBP", exchangeRate: 1.25, baseAmount: 25, baseCurrency: "USD", converted: true },
    }] });
    renderRoute(<RecurringExpenses />);
    await screen.findByText("London Storage");
    expect(screen.getByText(/USD.*25.*at 1\.25/)).toBeInTheDocument();
  });

  it("submits recurring currency without a client-controlled rate", async () => {
    api.createRecurringExpense.mockResolvedValue({ recurringExpense: {} });
    renderRoute(<RecurringExpenses />);
    await screen.findByText(/no recurring expenses/i);
    await userEvent.click(screen.getByRole("button", { name: /add recurring expense/i }));
    await userEvent.type(screen.getByLabelText("Vendor"), "Euro Hosting");
    await userEvent.type(screen.getByLabelText(/Amount \(USD\)/), "15");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.click(screen.getByRole("button", { name: /^add recurring expense$/i }));
    await waitFor(() => expect(api.createRecurringExpense).toHaveBeenCalled());
    expect(api.createRecurringExpense.mock.calls[0][1]).toEqual(expect.objectContaining({ currency: "EUR" }));
    expect(api.createRecurringExpense.mock.calls[0][1]).not.toHaveProperty("exchangeRate");
  });

  it("defaults the manual contribution selector to base currency", async () => {
    setSpace({ currency: "KES" });
    renderRoute(<Contributions />);
    await userEvent.click(await screen.findByRole("button", { name: /add manually/i }));
    expect(screen.getByLabelText("Currency")).toHaveValue("KES");
  });

  it("does not reveal a caller-controlled contribution rate", async () => {
    renderRoute(<Contributions />);
    await userEvent.click(await screen.findByRole("button", { name: /add manually/i }));
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    expect(screen.queryByLabelText(/exchange rate/i)).not.toBeInTheDocument();
  });

  it("renders contribution original and converted values", async () => {
    api.listContributions.mockResolvedValue({ contributions: [{
      id: "c1", contributor_name: "Amina", amount: 100, status: "completed", payment_method: "manual", created_at: "2026-01-01T00:00:00Z", message: "",
      money: { originalAmount: 100, currency: "EUR", exchangeRate: 1.5, baseAmount: 150, baseCurrency: "USD", converted: true },
    }] });
    renderRoute(<Contributions />);
    await screen.findByText("Amina");
    expect(screen.getByText(/USD.*150.*at 1\.5/)).toBeInTheDocument();
  });
});

describe("base currency settings", () => {
  it("loads supported currency metadata", async () => {
    renderRoute(<Settings />);
    await waitFor(() => expect(api.listCurrencies).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("option", { name: "KES — Kenyan Shilling" })).toBeInTheDocument();
  });

  it("shows an accessible loading state for metadata", () => {
    api.listCurrencies.mockReturnValue(new Promise(() => {}));
    renderRoute(<Settings />);
    expect(screen.getByText(/loading supported currencies/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Base currency")).toBeDisabled();
  });

  it("keeps fallback options and shows an API error", async () => {
    api.listCurrencies.mockRejectedValue(new Error("metadata offline"));
    renderRoute(<Settings />);
    expect(await screen.findByText(/currency list unavailable: metadata offline/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "USD — US Dollar" })).toBeInTheDocument();
  });

  it("starts with the persisted base currency", async () => {
    setSpace({ currency: "KES" });
    renderRoute(<Settings />);
    expect(screen.getByLabelText("Base currency")).toHaveValue("KES");
    expect(screen.getByText("Goal amount (KES)")).toBeInTheDocument();
  });

  it("submits a changed base currency", async () => {
    api.updateLifeSpace.mockResolvedValue({ lifeSpace: {} });
    renderRoute(<Settings />);
    await waitFor(() => expect(screen.getByLabelText("Base currency")).not.toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText("Base currency"), "EUR");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(api.updateLifeSpace).toHaveBeenCalled());
    expect(api.updateLifeSpace.mock.calls[0][1]).toEqual(expect.objectContaining({ currency: "EUR" }));
  });

  it("surfaces a rejected base-currency change", async () => {
    api.updateLifeSpace.mockRejectedValue(new Error("Base currency cannot be changed after financial activity has been recorded"));
    renderRoute(<Settings />);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/cannot be changed after financial activity/i)).toBeInTheDocument();
  });

  it("shows base currency read-only for a volunteer", async () => {
    setSpace({ role: "volunteer", currency: "GBP" });
    renderRoute(<Settings />);
    expect(screen.queryByLabelText("Base currency")).not.toBeInTheDocument();
    expect(screen.getByText(/doesn't include editing/i)).toBeInTheDocument();
  });
});

describe("normalized dashboard and report display", () => {
  const dashboardData = {
    stats: { goal: 10000, raised: 1300, spent: 500, available: 800, remainingGoal: 8700, progress: 13 },
    categoryBreakdown: [], monthlyTrend: [], notifications: [], financialHealth: { score: 100, rating: "Excellent", flags: [], projectedOver: [] },
    upcomingRecurringExpenses: [{
      recurringExpenseId: "r1", vendor: "Euro Hosting", categoryId: null, category: null, dueDate: "2027-01-01", amount: 10,
      money: { originalAmount: 10, currency: "EUR", exchangeRate: 1.2, baseAmount: 12, baseCurrency: "USD", converted: true },
    }],
    recentContributions: [{
      id: "c1", contributor_name: "Amina", message: "Thanks", amount: 10,
      money: { originalAmount: 10, currency: "EUR", exchangeRate: 1.2, baseAmount: 12, baseCurrency: "USD", converted: true },
    }],
  };

  it("formats all dashboard totals in the base currency", async () => {
    setSpace({ currency: "KES" });
    api.getDashboard.mockResolvedValue(dashboardData);
    renderRoute(<Dashboard />);
    await screen.findByText("Financial Health");
    expect(screen.getAllByText(/KSh|KES/, { selector: ".stat-card .value" })).toHaveLength(5);
    expect(screen.queryByText("$10,000")).not.toBeInTheDocument();
  });

  it("shows original and converted upcoming recurring amounts", async () => {
    api.getDashboard.mockResolvedValue(dashboardData);
    renderRoute(<Dashboard />);
    await screen.findByText("Euro Hosting");
    expect(screen.getAllByText(/USD.*12.*at 1\.2/).length).toBeGreaterThan(0);
  });

  it("shows original and converted recent contributions", async () => {
    api.getDashboard.mockResolvedValue(dashboardData);
    renderRoute(<Dashboard />);
    const row = (await screen.findByText("Amina")).closest("tr");
    expect(within(row).getByText(/EUR\s*10|10.*EUR/)).toBeInTheDocument();
    expect(within(row).getByText(/USD.*12.*at 1\.2/)).toBeInTheDocument();
  });

  it("renders report figures using its supplied currency", () => {
    renderRoute(<MilestoneReport lifeSpace={{ title: "Kenya Event", milestoneType: "wedding", currency: "KES" }} stats={{ goal: 10000, raised: 2500, remainingGoal: 7500, progress: 25, currency: "KES" }} categoryBreakdown={[]} />);
    expect(screen.getAllByText(/KSh|KES/).length).toBeGreaterThan(2);
    expect(screen.queryByText("$10,000")).not.toBeInTheDocument();
  });
});
