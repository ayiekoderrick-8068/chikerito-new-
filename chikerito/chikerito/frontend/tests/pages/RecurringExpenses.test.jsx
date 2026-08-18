import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import RecurringExpenses from "../../src/pages/RecurringExpenses.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const categories = [{ id: "cat1", name: "Utilities" }];
const rules = [
  { id: "r1", vendor: "Storage Unit", category_id: "cat1", amount: 75, frequency: "monthly", status: "active", start_date: "2026-01-01", end_date: null, nextOccurrence: "2026-09-01" },
  { id: "r2", vendor: "Gym", category_id: null, amount: 30, frequency: "weekly", status: "paused", start_date: "2026-01-01", end_date: null, nextOccurrence: null },
  { id: "r3", vendor: "Old Subscription", category_id: null, amount: 10, frequency: "yearly", status: "stopped", start_date: "2020-01-01", end_date: null, nextOccurrence: null },
];

function mockLifeSpace(role) {
  useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", role } });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RecurringExpenses />
    </MemoryRouter>
  );
}

describe("RecurringExpenses", () => {
  beforeEach(() => {
    mockLifeSpace("owner");
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: rules });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("prompts to create a life space when there is none yet", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are none", async () => {
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: [] });
    renderPage();
    expect(await screen.findByText(/no recurring expenses set up yet/i)).toBeInTheDocument();
  });

  it("shows an error banner if loading fails", async () => {
    api.listRecurringExpenses.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("lists rules with vendor, category, amount, frequency, status, and next occurrence", async () => {
    renderPage();
    await screen.findByText("Storage Unit");

    expect(screen.getByText("Utilities")).toBeInTheDocument();
    expect(screen.getByText("$75")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("Gym")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });

  it("falls back to Uncategorized when there is no category", async () => {
    renderPage();
    await screen.findByText("Gym");
    expect(screen.getAllByText("Uncategorized").length).toBeGreaterThan(0);
  });

  it("shows Pause only for active rules and Resume only for paused ones", async () => {
    renderPage();
    await screen.findByText("Storage Unit");

    const activeRow = screen.getByText("Storage Unit").closest("tr");
    const pausedRow = screen.getByText("Gym").closest("tr");
    expect(within(activeRow).getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(within(activeRow).queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    expect(within(pausedRow).getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(within(pausedRow).queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
  });

  it("a stopped rule has no Edit/Pause/Stop actions", async () => {
    renderPage();
    await screen.findByText("Old Subscription");
    const stoppedRow = screen.getByText("Old Subscription").closest("tr");
    expect(within(stoppedRow).queryByRole("button")).not.toBeInTheDocument();
  });

  it("creates a recurring expense", async () => {
    api.createRecurringExpense.mockResolvedValue({ recurringExpense: { id: "r4" } });
    renderPage();
    await screen.findByText("Storage Unit");

    await userEvent.click(screen.getByRole("button", { name: /add recurring expense/i }));
    const modal = screen.getByRole("heading", { name: "Add Recurring Expense" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/storage unit/i), "Rent");
    await userEvent.type(modal.querySelector('input[type="number"]'), "500");

    await userEvent.click(within(modal).getByRole("button", { name: /^add recurring expense$/i }));

    await waitFor(() =>
      expect(api.createRecurringExpense).toHaveBeenCalledWith(
        "ls1",
        expect.objectContaining({ vendor: "Rent", amount: "500", frequency: "monthly" })
      )
    );
  });

  it("pausing calls the pause endpoint and reloads", async () => {
    api.pauseRecurringExpense.mockResolvedValue({ recurringExpense: { ...rules[0], status: "paused" } });
    renderPage();
    await screen.findByText("Storage Unit");
    const activeRow = screen.getByText("Storage Unit").closest("tr");

    await userEvent.click(within(activeRow).getByRole("button", { name: /pause/i }));

    await waitFor(() => expect(api.pauseRecurringExpense).toHaveBeenCalledWith("r1"));
  });

  it("resuming calls the resume endpoint and reloads", async () => {
    api.resumeRecurringExpense.mockResolvedValue({ recurringExpense: { ...rules[1], status: "active" } });
    renderPage();
    await screen.findByText("Gym");
    const pausedRow = screen.getByText("Gym").closest("tr");

    await userEvent.click(within(pausedRow).getByRole("button", { name: /resume/i }));

    await waitFor(() => expect(api.resumeRecurringExpense).toHaveBeenCalledWith("r2"));
  });

  it("stopping asks for confirmation and calls the delete endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteRecurringExpense.mockResolvedValue({});
    renderPage();
    await screen.findByText("Storage Unit");
    const activeRow = screen.getByText("Storage Unit").closest("tr");

    await userEvent.click(within(activeRow).getByRole("button", { name: /stop/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteRecurringExpense).toHaveBeenCalledWith("r1"));
  });

  it("does not stop when the user cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByText("Storage Unit");
    const activeRow = screen.getByText("Storage Unit").closest("tr");

    await userEvent.click(within(activeRow).getByRole("button", { name: /stop/i }));

    expect(api.deleteRecurringExpense).not.toHaveBeenCalled();
  });

  it("editing pre-fills the form and disables the start/end date fields", async () => {
    renderPage();
    await screen.findByText("Storage Unit");
    const activeRow = screen.getByText("Storage Unit").closest("tr");

    await userEvent.click(within(activeRow).getByRole("button", { name: /edit/i }));

    const modal = screen.getByText("Edit Recurring Expense").closest(".modal");
    expect(within(modal).getByPlaceholderText(/storage unit/i)).toHaveValue("Storage Unit");
    const dateInputs = modal.querySelectorAll('input[type="date"]');
    dateInputs.forEach((input) => expect(input).toBeDisabled());
  });

  it("submitting an edit sends only vendor/amount/category/frequency", async () => {
    api.updateRecurringExpense.mockResolvedValue({ recurringExpense: rules[0] });
    renderPage();
    await screen.findByText("Storage Unit");
    const activeRow = screen.getByText("Storage Unit").closest("tr");
    await userEvent.click(within(activeRow).getByRole("button", { name: /edit/i }));

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      // amount stays a number here (copied straight from the rule by openEdit,
      // never typed into) — unlike the create flow, where typing into the
      // input always produces a string.
      expect(api.updateRecurringExpense).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ vendor: "Storage Unit", amount: 75, categoryId: "cat1", frequency: "monthly" })
      )
    );
    const [, payload] = api.updateRecurringExpense.mock.calls[0];
    expect(payload).not.toHaveProperty("startDate");
    expect(payload).not.toHaveProperty("endDate");
  });
});

describe("RecurringExpenses — role-based guards", () => {
  beforeEach(() => {
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: rules });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("hides Add/Edit/Pause/Stop for a role without expense:manage", async () => {
    mockLifeSpace("volunteer");
    renderPage();
    await screen.findByText("Storage Unit");

    expect(screen.queryByRole("button", { name: /add recurring expense/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
  });

  it("shows the manage controls for finance_manager, which has expense:manage", async () => {
    mockLifeSpace("finance_manager");
    renderPage();
    await screen.findByText("Storage Unit");
    expect(screen.getByRole("button", { name: /add recurring expense/i })).toBeInTheDocument();
  });

  it("hides the manage controls for event_planner, which does not have expense:manage", async () => {
    mockLifeSpace("event_planner");
    renderPage();
    await screen.findByText("Storage Unit");
    expect(screen.queryByRole("button", { name: /add recurring expense/i })).not.toBeInTheDocument();
  });
});
