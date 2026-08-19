import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import BudgetScenarios from "../../src/pages/BudgetScenarios.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const categories = [
  { id: "cat-venue", name: "Venue", budget_amount: 1000 },
  { id: "cat-food", name: "Catering", budget_amount: 500 },
];

const forecast = {
  asOf: "2026-08-18",
  horizonDate: "2026-12-31",
  currency: "USD",
  totals: {
    currentBudget: 1500,
    scenarioBudget: 1800,
    budgetChange: 300,
    currentSpent: 600,
    projectedRecurring: 200,
    projectedExpenses: 300,
    forecastSpent: 1100,
    spendingChange: 500,
    currentRaised: 700,
    projectedContributions: 250,
    forecastRaised: 950,
    fundingGap: 150,
    projectedAvailable: 0,
  },
  comparison: {
    budget: { current: 1500, scenario: 1800, difference: 300 },
    spent: { current: 600, scenario: 1100, difference: 500 },
    raised: { current: 700, scenario: 950, difference: 250 },
  },
  categoryForecasts: [{
    categoryId: "cat-venue",
    name: "Venue",
    currentBudget: 1000,
    scenarioBudget: 1200,
    currentSpent: 500,
    projectedRecurring: 200,
    projectedExpenses: 600,
    forecastSpent: 1300,
    projectedOverBudget: true,
    overBudgetBy: 100,
  }, {
    categoryId: "cat-food",
    name: "Catering",
    currentBudget: 500,
    scenarioBudget: 600,
    currentSpent: 100,
    projectedRecurring: 0,
    projectedExpenses: 0,
    forecastSpent: 100,
    projectedOverBudget: false,
    overBudgetBy: 0,
  }],
  recurringOccurrences: [{ recurringExpenseId: "rent", vendor: "Chair rental", amount: 200, dueDate: "2026-10-01" }],
  warnings: [{ categoryId: "cat-venue", category: "Venue", overBy: 100, message: "Venue is projected to exceed its scenario budget by 100.00" }],
};

const scenario = {
  id: "scenario-1",
  name: "Expanded guest list",
  description: "A larger reception option.",
  horizonDate: "2026-12-31",
  allocations: [{ categoryId: "cat-venue", budgetAmount: 1200, projectedExpenses: 600, projectedContributions: 100, note: "Tentative" }],
  summary: { scenarioBudget: 1800, forecastSpent: 1100, forecastRaised: 950, fundingGap: 150, warningCount: 1 },
  forecast,
};

const secondScenario = {
  ...scenario,
  id: "scenario-2",
  name: "Lean plan",
  description: "Smaller option.",
  horizonDate: "2027-01-31",
  summary: { ...scenario.summary, warningCount: 0 },
  forecast: { ...forecast, horizonDate: "2027-01-31", warnings: [], recurringOccurrences: [] },
};

function lifeSpace(role = "owner", id = "space-1") {
  useLifeSpace.mockReturnValue({
    currentId: id,
    current: { id, role, currency: "USD" },
    lifeSpaces: [{ id, title: "Current space", role }],
    selectLifeSpace: vi.fn(),
  });
}

function renderPage() {
  return render(<MemoryRouter><BudgetScenarios /></MemoryRouter>);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("BudgetScenarios loading and selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [scenario] });
    api.listCategories.mockResolvedValue({ categories });
    api.previewBudgetScenario.mockResolvedValue({ forecast, readOnly: true });
    api.createBudgetScenario.mockResolvedValue({ scenario: { ...scenario, id: "created" } });
    api.updateBudgetScenario.mockResolvedValue({ scenario });
    api.deleteBudgetScenario.mockResolvedValue({});
  });

  it("prompts for a life space when none is selected", () => {
    useLifeSpace.mockReturnValue({ currentId: null, current: null, lifeSpaces: [], selectLifeSpace: vi.fn() });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
  });

  it("shows an explicit loading state", async () => {
    const pending = deferred();
    api.listBudgetScenarios.mockReturnValue(pending.promise);
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading budget scenarios");
    pending.resolve({ scenarios: [] });
    await screen.findByText("No budget scenarios yet");
  });

  it("shows a useful empty state", async () => {
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [] });
    renderPage();
    expect(await screen.findByText("No budget scenarios yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create first scenario" })).toBeInTheDocument();
  });

  it("shows a load error and retries both resources", async () => {
    api.listBudgetScenarios.mockRejectedValueOnce(new Error("Forecast service unavailable")).mockResolvedValueOnce({ scenarios: [scenario] });
    renderPage();
    expect(await screen.findByText("Forecast service unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByText("Expanded guest list")).toHaveLength(2);
    expect(api.listBudgetScenarios).toHaveBeenCalledTimes(2);
    expect(api.listCategories).toHaveBeenCalledTimes(2);
  });

  it("loads scenarios and categories for the selected life space", async () => {
    renderPage();
    await screen.findByText("A larger reception option.");
    expect(api.listBudgetScenarios).toHaveBeenCalledWith("space-1");
    expect(api.listCategories).toHaveBeenCalledWith("space-1");
  });

  it("renders scenario name, description, horizon, and warning count", async () => {
    renderPage();
    expect(await screen.findAllByText("Expanded guest list")).toHaveLength(2);
    expect(screen.getByText("A larger reception option.")).toBeInTheDocument();
    expect(screen.getAllByText("Through 2026-12-31").length).toBeGreaterThan(0);
    expect(screen.getByText("1 projected warning")).toBeInTheDocument();
  });

  it("switches the read-only forecast when another scenario is selected", async () => {
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [scenario, secondScenario] });
    renderPage();
    const lean = await screen.findByRole("button", { name: /lean plan/i });
    await userEvent.click(lean);
    expect(screen.getByRole("button", { name: /lean plan/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/read-only forecast as of 2026-08-18/i)).toBeInTheDocument();
    expect(screen.getAllByText(/through 2027-01-31/i).length).toBeGreaterThan(0);
  });

  it("reloads and clears selection when the life space changes", async () => {
    const view = renderPage();
    await screen.findByText("A larger reception option.");
    lifeSpace("owner", "space-2");
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [] });
    view.rerender(<MemoryRouter><BudgetScenarios /></MemoryRouter>);
    expect(await screen.findByText("No budget scenarios yet")).toBeInTheDocument();
    expect(api.listBudgetScenarios).toHaveBeenCalledWith("space-2");
  });
});

describe("BudgetScenarios forecast presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [scenario] });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("renders forecast totals and their current-state changes", async () => {
    renderPage();
    await screen.findByText("Forecast spending");
    expect(screen.getAllByText("$1,100.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$200.00 recurring")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument();
  });

  it("renders a current-versus-scenario comparison table", async () => {
    renderPage();
    const table = (await screen.findByText("Current vs scenario")).closest(".scenario-comparison");
    expect(within(table).getByRole("columnheader", { name: "Current" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Budget" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Spent" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Raised" })).toBeInTheDocument();
  });

  it("renders projected warning messages in an alert region", async () => {
    renderPage();
    const warnings = await screen.findByRole("alert", { name: "Projected budget warnings" });
    expect(warnings).toHaveTextContent("Venue is projected to exceed");
  });

  it("shows category forecasts and over-budget status", async () => {
    renderPage();
    await screen.findByText("Category forecast");
    expect(screen.getByText("Over by $100.00")).toBeInTheDocument();
    expect(screen.getByText("Within budget")).toBeInTheDocument();
  });

  it("lists projected recurring vendor, amount, and due date", async () => {
    renderPage();
    expect(await screen.findByText("Chair rental")).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toHaveAttribute("datetime", "2026-10-01");
  });

  it("shows a recurring projection empty state", async () => {
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [secondScenario] });
    renderPage();
    expect(await screen.findByText(/no active recurring expenses fall within this horizon/i)).toBeInTheDocument();
  });
});

describe("BudgetScenarios editor and write controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [scenario] });
    api.listCategories.mockResolvedValue({ categories });
    api.previewBudgetScenario.mockResolvedValue({ forecast, readOnly: true });
    api.createBudgetScenario.mockResolvedValue({ scenario: { ...scenario, id: "created" } });
    api.updateBudgetScenario.mockResolvedValue({ scenario });
    api.deleteBudgetScenario.mockResolvedValue({});
  });

  it.each(["volunteer", "event_planner", "editor"])("hides write controls for %s", async (role) => {
    lifeSpace(role);
    renderPage();
    await screen.findByText("A larger reception option.");
    expect(screen.queryByRole("button", { name: /new scenario/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it.each(["owner", "finance_manager"])("shows write controls for %s", async (role) => {
    lifeSpace(role);
    renderPage();
    await screen.findByText("A larger reception option.");
    expect(screen.getByRole("button", { name: /new scenario/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("opens an accessible create editor and cancels it", async () => {
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(screen.getByRole("dialog", { name: "Create budget scenario" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/never changes real budgets/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pre-fills existing values in the edit form", async () => {
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Scenario name")).toHaveValue("Expanded guest list");
    expect(screen.getByLabelText("Forecast through")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("Venue scenario budget")).toHaveValue(1200);
    expect(screen.getByLabelText("Venue note")).toHaveValue("Tentative");
  });

  it("builds a safe preview from edited category assumptions", async () => {
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Venue projected expenses"), { target: { value: "750" } });
    await userEvent.click(screen.getByRole("button", { name: "Preview safely" }));
    await waitFor(() => expect(api.previewBudgetScenario).toHaveBeenCalledWith("space-1", expect.objectContaining({
      name: "Expanded guest list",
      allocations: expect.arrayContaining([expect.objectContaining({ categoryId: "cat-venue", projectedExpenses: 750 })]),
    })));
    expect(await screen.findByText("Draft preview")).toBeInTheDocument();
  });

  it("shows a preview error without closing the editor", async () => {
    api.previewBudgetScenario.mockRejectedValue(new Error("Preview rejected"));
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Preview safely" }));
    expect(await screen.findByText("Preview rejected")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit budget scenario" })).toBeInTheDocument();
  });

  it("creates a scenario with only changed category assumptions", async () => {
    api.listBudgetScenarios.mockResolvedValue({ scenarios: [] });
    renderPage();
    await screen.findByText("No budget scenarios yet");
    await userEvent.click(screen.getByRole("button", { name: "Create first scenario" }));
    fireEvent.change(screen.getByLabelText("Scenario name"), { target: { value: "New plan" } });
    fireEvent.change(screen.getByLabelText("Venue projected contributions"), { target: { value: "400" } });
    await userEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    await waitFor(() => expect(api.createBudgetScenario).toHaveBeenCalledWith("space-1", expect.objectContaining({
      name: "New plan",
      allocations: [expect.objectContaining({ categoryId: "cat-venue", projectedContributions: 400 })],
    })));
  });

  it("updates an existing scenario", async () => {
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Scenario name"), { target: { value: "Revised plan" } });
    await userEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    await waitFor(() => expect(api.updateBudgetScenario).toHaveBeenCalledWith("scenario-1", expect.objectContaining({ name: "Revised plan" })));
  });

  it("keeps the editor open and shows a save error", async () => {
    api.updateBudgetScenario.mockRejectedValue(new Error("Save failed"));
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not delete when confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteBudgetScenario).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and reloads", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("A larger reception option.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteBudgetScenario).toHaveBeenCalledWith("scenario-1"));
    expect(api.listBudgetScenarios).toHaveBeenCalledTimes(2);
  });
});
