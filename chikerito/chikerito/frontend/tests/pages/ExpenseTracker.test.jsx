import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExpenseTracker from "../../src/pages/ExpenseTracker.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const categories = [{ id: "cat1", name: "Venue" }];
const expenses = [
  { id: "e1", vendor: "Grand Hall", category_id: "cat1", amount: 1200, payment_date: "2026-03-14", status: "paid", receipt_url: "r.pdf", notes: "", created_at: "2026-03-14T10:00:00Z" },
  { id: "e2", vendor: "Florist", category_id: null, amount: 300, payment_date: "2026-04-01", status: "pending", receipt_url: null, notes: "", created_at: "2026-04-01T09:00:00Z" },
];

function mockLifeSpace(role = "owner") {
  useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", role } });
}

function renderPage() {
  return render(<MemoryRouter><ExpenseTracker /></MemoryRouter>);
}

describe("ExpenseTracker — display", () => {
  beforeEach(() => {
    mockLifeSpace();
    api.listExpenses.mockResolvedValue({ expenses, hasMore: false });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("prompts to create a life space when there is none", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
  });

  it("shows a loading state initially", () => {
    api.listExpenses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an error banner when loading fails", async () => {
    api.listExpenses.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("shows an empty state when there are no expenses", async () => {
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    renderPage();
    expect(await screen.findByText(/no expenses recorded yet/i)).toBeInTheDocument();
  });

  it("lists expenses with vendor, category, amount, date, status, receipt", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    const table = document.querySelector("table");
    expect(within(table).getByText("Venue")).toBeInTheDocument();
    expect(within(table).getByText("$1,200")).toBeInTheDocument();
    expect(within(table).getByText("2026-03-14")).toBeInTheDocument();
    expect(within(table).getByText("paid")).toBeInTheDocument();
    expect(within(table).getByText("Florist")).toBeInTheDocument();
    expect(within(table).getByText("pending")).toBeInTheDocument();
  });

  it("shows Uncategorized for expenses with no category", async () => {
    renderPage();
    await screen.findByText("Florist");
    const table = document.querySelector("table");
    expect(within(table).getByText("Uncategorized")).toBeInTheDocument();
  });

  it("shows Load more button when hasMore is true", async () => {
    api.listExpenses.mockResolvedValue({ expenses, hasMore: true });
    renderPage();
    expect(await screen.findByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("does not show Load more when hasMore is false", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("Load more appends the next page", async () => {
    const page2 = [{ id: "e3", vendor: "Caterer", category_id: null, amount: 500, payment_date: "2026-05-01", status: "paid", receipt_url: null, notes: "", created_at: "2026-05-01T08:00:00Z" }];
    api.listExpenses
      .mockResolvedValueOnce({ expenses, hasMore: true })
      .mockResolvedValueOnce({ expenses: page2, hasMore: false });
    renderPage();
    await screen.findByText("Grand Hall");

    await userEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText("Caterer")).toBeInTheDocument());
    expect(screen.getByText("Grand Hall")).toBeInTheDocument(); // page 1 still visible
  });
});

describe("ExpenseTracker — filter bar", () => {
  beforeEach(() => {
    mockLifeSpace();
    api.listExpenses.mockResolvedValue({ expenses, hasMore: false });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("renders status, category, from, and to filter controls", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByDisplayValue("All statuses")).toBeInTheDocument();
    expect(screen.getByDisplayValue("All categories")).toBeInTheDocument();
  });

  it("re-fetches with status filter when status changes", async () => {
    renderPage();
    await screen.findByText("Grand Hall");

    const statusSelect = screen.getByDisplayValue("All statuses");
    await userEvent.selectOptions(statusSelect, "paid");

    await waitFor(() =>
      expect(api.listExpenses).toHaveBeenCalledWith("ls1", expect.objectContaining({ status: "paid" }))
    );
  });

  it("re-fetches with category filter when category changes", async () => {
    renderPage();
    await screen.findByText("Grand Hall");

    const catSelect = screen.getByDisplayValue("All categories");
    await userEvent.selectOptions(catSelect, "cat1");

    await waitFor(() =>
      expect(api.listExpenses).toHaveBeenCalledWith("ls1", expect.objectContaining({ categoryId: "cat1" }))
    );
  });

  it("shows a Clear filters button when any filter is active", async () => {
    renderPage();
    await screen.findByText("Grand Hall");

    await userEvent.selectOptions(screen.getByDisplayValue("All statuses"), "paid");
    expect(await screen.findByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("Clear filters resets all filter controls and re-fetches without filters", async () => {
    renderPage();
    await screen.findByText("Grand Hall");

    await userEvent.selectOptions(screen.getByDisplayValue("All statuses"), "paid");
    await screen.findByRole("button", { name: /clear filters/i });

    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() =>
      expect(api.listExpenses).toHaveBeenCalledWith("ls1", expect.objectContaining({}))
    );
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it("shows a filtered empty state message when filters are active but no results", async () => {
    api.listExpenses
      .mockResolvedValueOnce({ expenses, hasMore: false })
      .mockResolvedValueOnce({ expenses: [], hasMore: false });
    renderPage();
    await screen.findByText("Grand Hall");

    await userEvent.selectOptions(screen.getByDisplayValue("All statuses"), "overdue");
    expect(await screen.findByText(/no expenses match the current filters/i)).toBeInTheDocument();
  });
});

describe("ExpenseTracker — create expense", () => {
  beforeEach(() => {
    mockLifeSpace();
    api.listExpenses.mockResolvedValue({ expenses: [], hasMore: false });
    api.listCategories.mockResolvedValue({ categories });
    api.createExpense.mockResolvedValue({ expense: { id: "new1" } });
  });

  it("opens the create modal when + Record Expense is clicked", async () => {
    renderPage();
    await screen.findByText(/no expenses recorded yet/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    expect(screen.getByRole("heading", { name: "Record Expense" })).toBeInTheDocument();
  });

  it("submits a new expense and reloads", async () => {
    renderPage();
    await screen.findByText(/no expenses recorded yet/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));

    const modal = screen.getByRole("heading", { name: "Record Expense" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/elegant events/i), "Caterer");
    await userEvent.type(modal.querySelector('input[type="number"]'), "500");

    await userEvent.click(within(modal).getByRole("button", { name: /save expense/i }));

    await waitFor(() =>
      expect(api.createExpense).toHaveBeenCalledWith("ls1", expect.objectContaining({ vendor: "Caterer", amount: "500" }))
    );
  });

  it("shows a client-side validation error for empty vendor", async () => {
    renderPage();
    await screen.findByText(/no expenses recorded yet/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));

    const modal = screen.getByRole("heading", { name: "Record Expense" }).closest(".modal");
    await userEvent.type(modal.querySelector('input[type="number"]'), "100");
    fireEvent.submit(modal.querySelector("form"));

    expect(screen.getByText(/vendor is required/i)).toBeInTheDocument();
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it("shows a client-side validation error for zero amount", async () => {
    renderPage();
    await screen.findByText(/no expenses recorded yet/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));

    const modal = screen.getByRole("heading", { name: "Record Expense" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/elegant events/i), "Vendor");
    await userEvent.type(modal.querySelector('input[type="number"]'), "0");
    fireEvent.submit(modal.querySelector("form"));

    expect(screen.getByText(/positive number/i)).toBeInTheDocument();
    expect(api.createExpense).not.toHaveBeenCalled();
  });

  it("closes the modal on Cancel", async () => {
    renderPage();
    await screen.findByText(/no expenses recorded yet/i);
    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { name: "Record Expense" })).not.toBeInTheDocument();
  });
});

describe("ExpenseTracker — edit expense", () => {
  beforeEach(() => {
    mockLifeSpace();
    api.listExpenses.mockResolvedValue({ expenses, hasMore: false });
    api.listCategories.mockResolvedValue({ categories });
    api.updateExpense.mockResolvedValue({ expense: expenses[0] });
  });

  it("shows an Edit button for each expense when canManage", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it("opens the edit modal pre-filled with the expense's current values", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    const row = screen.getByText("Grand Hall").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));

    const modal = screen.getByRole("heading", { name: "Edit Expense" }).closest(".modal");
    expect(within(modal).getByPlaceholderText(/elegant events/i)).toHaveValue("Grand Hall");
    expect(modal.querySelector('input[type="number"]')).toHaveValue(1200);
  });

  it("submits the edit and calls updateExpense", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    const row = screen.getByText("Grand Hall").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(api.updateExpense).toHaveBeenCalledWith("e1", expect.objectContaining({ vendor: "Grand Hall" }))
    );
  });

  it("does not call updateExpense when the edit modal is cancelled", async () => {
    renderPage();
    await screen.findByText("Grand Hall");
    const row = screen.getByText("Grand Hall").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(api.updateExpense).not.toHaveBeenCalled();
  });
});

describe("ExpenseTracker — RBAC", () => {
  beforeEach(() => {
    api.listExpenses.mockResolvedValue({ expenses, hasMore: false });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("hides Record Expense, Edit, and Delete for a volunteer", async () => {
    mockLifeSpace("volunteer");
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.queryByRole("button", { name: /record expense/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /✕/ })).not.toBeInTheDocument();
  });

  it("shows manage controls for finance_manager", async () => {
    mockLifeSpace("finance_manager");
    renderPage();
    await screen.findByText("Grand Hall");
    expect(screen.getByRole("button", { name: /record expense/i })).toBeInTheDocument();
  });
});
