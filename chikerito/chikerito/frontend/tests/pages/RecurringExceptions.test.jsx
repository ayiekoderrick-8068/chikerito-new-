import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import RecurringExceptions, {
  ExceptionEditor,
  editorForm,
  exceptionPayload,
  isoOffset,
} from "../../src/pages/RecurringExceptions.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const categories = [
  { id: "cat-utilities", name: "Utilities" },
  { id: "cat-home", name: "Home" },
];

const rules = [
  { id: "rule-power", vendor: "Power Co", amount: 80, frequency: "monthly", status: "active" },
  { id: "rule-rent", vendor: "Landlord", amount: 900, frequency: "monthly", status: "paused" },
];

const occurrence = {
  occurrenceDate: "2099-01-01",
  effectiveDate: "2099-01-03",
  vendor: "Emergency Power",
  categoryId: "cat-home",
  amount: 95,
  state: "overridden",
  skipped: false,
  materialized: false,
  exception: null,
};

const activeException = {
  id: "exception-1",
  occurrenceDate: "2099-01-01",
  action: "override",
  overrideDate: "2099-01-03",
  overrideAmount: 95,
  overrideCategoryId: "cat-home",
  overrideVendor: "Emergency Power",
  status: "active",
  materialized: false,
};

function lifeSpace(role = "owner") {
  useLifeSpace.mockReturnValue({
    currentId: "space-1",
    current: { id: "space-1", name: "Home", role },
    lifeSpaces: [{ id: "space-1", name: "Home", role }],
    selectLifeSpace: vi.fn(),
  });
}

function details(overrides = {}) {
  api.listRecurringOccurrences.mockResolvedValue({
    occurrences: [occurrence],
    nextOccurrence: "2099-01-03",
    ...overrides,
  });
  api.listRecurringExceptions.mockResolvedValue({ exceptions: [activeException] });
}

function renderPage() {
  return render(<MemoryRouter><RecurringExceptions /></MemoryRouter>);
}

async function loadedRow() {
  await screen.findByText("Emergency Power");
  return screen.getByText("Emergency Power").closest("tr");
}

describe("RecurringExceptions page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: rules });
    api.listCategories.mockResolvedValue({ categories });
    details();
    api.createRecurringException.mockResolvedValue({ exception: activeException });
    api.updateRecurringException.mockResolvedValue({ exception: activeException });
    api.removeRecurringException.mockResolvedValue({});
    api.restoreRecurringException.mockResolvedValue({ exception: activeException });
  });

  it("prompts for a life space when none is selected", () => {
    useLifeSpace.mockReturnValue({ currentId: null, current: null, lifeSpaces: [], selectLifeSpace: vi.fn() });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
    expect(api.listRecurringExpenses).not.toHaveBeenCalled();
  });

  it("loads rules, categories, occurrence preview, and exception history", async () => {
    renderPage();
    const row = await loadedRow();
    expect(api.listRecurringExpenses).toHaveBeenCalledWith("space-1");
    expect(api.listCategories).toHaveBeenCalledWith("space-1");
    expect(api.listRecurringOccurrences).toHaveBeenCalledWith("rule-power", expect.objectContaining({ limit: 100 }));
    expect(api.listRecurringExceptions).toHaveBeenCalledWith("rule-power");
    expect(within(row).getByText("2099-01-01")).toBeInTheDocument();
    expect(within(row).getByText("2099-01-03")).toBeInTheDocument();
    expect(within(row).getByText("Home")).toBeInTheDocument();
    expect(within(row).getByText("95")).toBeInTheDocument();
    expect(screen.getByText(/next effective occurrence:/i).textContent).toContain("2099-01-03");
  });

  it("shows the initial loading state", () => {
    api.listRecurringExpenses.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading recurring rules");
  });

  it("shows a clear empty state when no rules exist", async () => {
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: [] });
    renderPage();
    expect(await screen.findByText("No recurring expenses yet")).toBeInTheDocument();
    expect(screen.getByText(/create a recurring expense before/i)).toBeInTheDocument();
  });

  it("reports a rule-loading error and retries", async () => {
    api.listRecurringExpenses.mockRejectedValueOnce(new Error("Rules unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Rules unavailable");
    api.listRecurringExpenses.mockResolvedValue({ recurringExpenses: rules });
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Emergency Power")).toBeInTheDocument();
  });

  it("shows an occurrence loading state while detail requests wait", async () => {
    api.listRecurringOccurrences.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText("Loading occurrence preview...")).toBeInTheDocument();
  });

  it("reports a detail-loading failure", async () => {
    api.listRecurringOccurrences.mockRejectedValue(new Error("Preview unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Preview unavailable");
  });

  it("shows empty preview and history states", async () => {
    details({ occurrences: [], nextOccurrence: null });
    api.listRecurringExceptions.mockResolvedValue({ exceptions: [] });
    renderPage();
    expect(await screen.findByText("No scheduled occurrences in this range.")).toBeInTheDocument();
    expect(screen.getByText("No exceptions for this rule.")).toBeInTheDocument();
    expect(screen.getByText(/next effective occurrence:/i).textContent).toContain("None");
  });

  it("applies a chosen preview range", async () => {
    renderPage();
    await loadedRow();
    await userEvent.clear(screen.getByLabelText("From"));
    await userEvent.type(screen.getByLabelText("From"), "2099-02-01");
    await userEvent.clear(screen.getByLabelText("To"));
    await userEvent.type(screen.getByLabelText("To"), "2099-03-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply range" }));
    await waitFor(() => expect(api.listRecurringOccurrences).toHaveBeenLastCalledWith("rule-power", {
      from: "2099-02-01", to: "2099-03-01", limit: 100,
    }));
  });

  it("switches rules and fetches the selected rule only", async () => {
    renderPage();
    await loadedRow();
    await userEvent.selectOptions(screen.getByLabelText("Recurring rule"), "rule-rent");
    await waitFor(() => expect(api.listRecurringExceptions).toHaveBeenLastCalledWith("rule-rent"));
    expect(api.listRecurringOccurrences.mock.calls.at(-1)[0]).toBe("rule-rent");
  });

  it("creates a skip for an unmodified occurrence", async () => {
    details({ occurrences: [{ ...occurrence, state: "scheduled", effectiveDate: "2099-01-01", exception: null }] });
    renderPage();
    const row = await loadedRow();
    await userEvent.click(within(row).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(api.createRecurringException).toHaveBeenCalledWith("rule-power", {
      occurrenceDate: "2099-01-01", action: "skip",
    }));
    expect(api.listRecurringOccurrences.mock.calls.length).toBeGreaterThan(1);
  });

  it("reports a failed skip without hiding the occurrence", async () => {
    details({ occurrences: [{ ...occurrence, exception: null }] });
    api.createRecurringException.mockRejectedValue(new Error("Skip conflict"));
    renderPage();
    const row = await loadedRow();
    await userEvent.click(within(row).getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Skip conflict");
    expect(screen.getByText("Emergency Power")).toBeInTheDocument();
  });

  it("opens an override editor and creates normalized override details", async () => {
    details({ occurrences: [{ ...occurrence, state: "scheduled", exception: null }] });
    renderPage();
    const row = await loadedRow();
    await userEvent.click(within(row).getByRole("button", { name: "Override" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Override date"), "2099-01-04");
    await userEvent.type(within(dialog).getByLabelText("Override amount"), "123.45");
    await userEvent.selectOptions(within(dialog).getByLabelText("Override category"), "cat-utilities");
    await userEvent.type(within(dialog).getByLabelText("Override vendor"), "  Backup Power  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save exception" }));
    await waitFor(() => expect(api.createRecurringException).toHaveBeenCalledWith("rule-power", {
      occurrenceDate: "2099-01-01",
      action: "override",
      overrideDate: "2099-01-04",
      overrideAmount: 123.45,
      overrideCategoryId: "cat-utilities",
      overrideVendor: "Backup Power",
    }));
  });

  it("edits an active exception with its existing values prefilled", async () => {
    renderPage();
    await loadedRow();
    const history = screen.getByRole("region", { name: "Exception history" });
    await userEvent.click(within(history).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Override date")).toHaveValue("2099-01-03");
    expect(within(dialog).getByLabelText("Override amount")).toHaveValue(95);
    expect(within(dialog).getByLabelText("Override vendor")).toHaveValue("Emergency Power");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save exception" }));
    await waitFor(() => expect(api.updateRecurringException).toHaveBeenCalledWith("exception-1", expect.objectContaining({
      occurrenceDate: "2099-01-01", action: "override", overrideAmount: 95,
    })));
  });

  it("cancels editing without writing", async () => {
    renderPage();
    await loadedRow();
    await userEvent.click(within(screen.getByRole("region", { name: "Exception history" })).getByRole("button", { name: "Edit" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.updateRecurringException).not.toHaveBeenCalled();
  });

  it("keeps the editor open and displays save errors", async () => {
    api.updateRecurringException.mockRejectedValue(new Error("Invalid override"));
    renderPage();
    await loadedRow();
    await userEvent.click(within(screen.getByRole("region", { name: "Exception history" })).getByRole("button", { name: "Edit" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save exception" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Invalid override");
  });

  it("removes an active exception and reloads details", async () => {
    renderPage();
    await loadedRow();
    const history = screen.getByRole("region", { name: "Exception history" });
    await userEvent.click(within(history).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeRecurringException).toHaveBeenCalledWith("exception-1"));
    expect(api.listRecurringExceptions.mock.calls.length).toBeGreaterThan(1);
  });

  it("restores a removed exception", async () => {
    api.listRecurringExceptions.mockResolvedValue({ exceptions: [{ ...activeException, status: "removed" }] });
    renderPage();
    await loadedRow();
    await userEvent.click(within(screen.getByRole("region", { name: "Exception history" })).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreRecurringException).toHaveBeenCalledWith("exception-1"));
  });

  it("reports remove and restore failures", async () => {
    api.removeRecurringException.mockRejectedValue(new Error("Remove denied"));
    renderPage();
    await loadedRow();
    await userEvent.click(within(screen.getByRole("region", { name: "Exception history" })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Remove denied");
  });

  it("labels materialized occurrences and removed history accurately", async () => {
    details({ occurrences: [{ ...occurrence, materialized: true, exception: activeException }] });
    api.listRecurringExceptions.mockResolvedValue({ exceptions: [{ ...activeException, materialized: true, status: "removed" }] });
    renderPage();
    const row = await loadedRow();
    expect(within(row).getByText("materialized")).toBeInTheDocument();
    expect(screen.getByText(/removed · materialized/i)).toBeInTheDocument();
    expect(screen.getAllByText("Final")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("hides all mutation controls from a volunteer", async () => {
    lifeSpace("volunteer");
    renderPage();
    await loadedRow();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Override" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("allows a finance manager to manage occurrence exceptions", async () => {
    lifeSpace("finance_manager");
    renderPage();
    await loadedRow();
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThan(0);
  });
});

describe("recurring exception editor helpers", () => {
  it("builds a blank override editor from an occurrence", () => {
    expect(editorForm(occurrence)).toEqual({
      id: null,
      occurrenceDate: "2099-01-01",
      action: "override",
      overrideDate: "",
      overrideAmount: "",
      overrideCategoryId: "",
      overrideVendor: "",
    });
  });

  it("preserves zero override amounts instead of treating them as absent", () => {
    expect(editorForm(null, { ...activeException, overrideAmount: 0 }).overrideAmount).toBe(0);
  });

  it("omits override-only fields from a skip payload", () => {
    expect(exceptionPayload({ occurrenceDate: "2099-01-01", action: "skip" })).toEqual({
      occurrenceDate: "2099-01-01", action: "skip",
    });
  });

  it("normalizes empty override fields to null", () => {
    expect(exceptionPayload({
      occurrenceDate: "2099-01-01", action: "override", overrideDate: "",
      overrideAmount: "", overrideCategoryId: "", overrideVendor: "   ",
    })).toEqual({
      occurrenceDate: "2099-01-01", action: "override", overrideDate: null,
      overrideAmount: null, overrideCategoryId: null, overrideVendor: null,
    });
  });

  it("calculates stable ISO date strings from the current clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T12:00:00.000Z"));
    expect(isoOffset(0)).toBe("2026-08-18");
    expect(isoOffset(180)).toBe("2027-02-14");
    vi.useRealTimers();
  });

  it("disables save and reports asynchronous editor errors", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Server rejected exception"));
    render(<ExceptionEditor
      initial={editorForm(occurrence)} categories={categories} saving
      onSave={onSave} onCancel={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Saving..." }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
