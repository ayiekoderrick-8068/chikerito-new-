import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExpenseTracker from "../../src/pages/ExpenseTracker.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter>
      <ExpenseTracker />
    </MemoryRouter>
  );
}

const categories = [{ id: "cat1", name: "Venue" }];
const expenses = [
  { id: "e1", vendor: "Grand Hall", category_id: "cat1", amount: 900, payment_date: "2026-03-14", status: "paid", receipt_url: "r.pdf" },
  { id: "e2", vendor: "Mystery Vendor", category_id: "no-such-category", amount: 50, payment_date: "2026-04-01", status: "pending", receipt_url: null },
];

describe("ExpenseTracker", () => {
  beforeEach(() => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1" });
    api.listExpenses.mockResolvedValue({ expenses });
    api.listCategories.mockResolvedValue({ categories });
  });

  it("prompts to create a life space when there is none yet", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
  });

  it("lists expenses with resolved category names, falling back to Uncategorized", async () => {
    renderPage();

    expect(await screen.findByText("Grand Hall")).toBeInTheDocument();
    expect(screen.getByText("Venue")).toBeInTheDocument();
    expect(screen.getByText("Mystery Vendor")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText("$900")).toBeInTheDocument();
  });

  it("shows an empty state when there are no expenses", async () => {
    api.listExpenses.mockResolvedValue({ expenses: [] });
    renderPage();
    expect(await screen.findByText(/no expenses recorded yet/i)).toBeInTheDocument();
  });

  it("opens the record-expense modal and submits a new expense", async () => {
    api.createExpense.mockResolvedValue({ expense: { id: "e3" } });
    renderPage();
    await screen.findByText("Grand Hall");

    await userEvent.click(screen.getByRole("button", { name: /record expense/i }));
    const modal = screen.getByText("Record Expense").closest(".modal");
    expect(modal).toBeInTheDocument();

    const vendorInput = within(modal).getByPlaceholderText(/elegant events/i);
    await userEvent.type(vendorInput, "Sunset Catering");
    const amountInput = modal.querySelector('input[type="number"]');
    await userEvent.type(amountInput, "350");

    await userEvent.click(within(modal).getByRole("button", { name: /save expense/i }));

    await waitFor(() =>
      expect(api.createExpense).toHaveBeenCalledWith(
        "ls1",
        expect.objectContaining({ vendor: "Sunset Catering", amount: "350", receiptUrl: null })
      )
    );
    // Reloads and closes the modal after a successful save.
    await waitFor(() => expect(screen.queryByText("Record Expense")).not.toBeInTheDocument());
  });

  it("deletes an expense after the user confirms", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteExpense.mockResolvedValue({});
    renderPage();
    await screen.findByText("Grand Hall");

    const row = screen.getByText("Grand Hall").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: "✕" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteExpense).toHaveBeenCalledWith("e1"));
  });

  it("does not delete when the user cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await screen.findByText("Grand Hall");

    const row = screen.getByText("Grand Hall").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: "✕" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.deleteExpense).not.toHaveBeenCalled();
  });
});
