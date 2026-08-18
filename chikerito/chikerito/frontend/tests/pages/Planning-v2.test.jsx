import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Planning from "../../src/pages/Planning.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const tasks = [
  { id: "t1", title: "Book venue", category: "Venue", due_date: "2026-06-20", priority: "high", completed: false, notes: "Ask for discount" },
  { id: "t2", title: "Order cake", category: "Catering", due_date: "2026-05-01", priority: "medium", completed: false, notes: "" },
  { id: "t3", title: "Pick songs", category: "Music", due_date: null, priority: "low", completed: true, notes: "" },
];

function mockLifeSpace(role = "owner") {
  useLifeSpace.mockReturnValue({
    lifeSpaces: [], selectLifeSpace: vi.fn(),
    currentId: "ls1", current: { id: "ls1", role },
  });
}

function renderPage() {
  return render(<MemoryRouter><Planning /></MemoryRouter>);
}

// ---------------------------------------------------------------------------
// Priority display
// ---------------------------------------------------------------------------
describe("Planning — priority display", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    mockLifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
  });
  afterEach(() => vi.useRealTimers());

  it("shows a priority badge for each task", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const badges = document.querySelectorAll(".priority-badge");
    expect(badges.length).toBe(tasks.length);
  });

  it("shows High badge for a high-priority task", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    expect(within(row).getByText("High")).toBeInTheDocument();
  });

  it("shows Medium badge for a medium-priority task", async () => {
    renderPage();
    await screen.findByText("Order cake");
    const row = screen.getByText("Order cake").closest("li");
    expect(within(row).getByText("Medium")).toBeInTheDocument();
  });

  it("shows Low badge for a low-priority task", async () => {
    renderPage();
    await screen.findByText("Pick songs");
    const row = screen.getByText("Pick songs").closest("li");
    expect(within(row).getByText("Low")).toBeInTheDocument();
  });

  it("falls back to Medium when priority is missing from the task object", async () => {
    const noPriority = [{ id: "t9", title: "No priority", category: "General", due_date: null, completed: false, notes: "" }];
    api.listTasks.mockResolvedValue({ tasks: noPriority });
    renderPage();
    await screen.findByText("No priority");
    const row = screen.getByText("No priority").closest("li");
    expect(within(row).getByText("Medium")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edit modal — open and prefill
// ---------------------------------------------------------------------------
describe("Planning — edit modal", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    mockLifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: tasks[0] });
  });
  afterEach(() => vi.useRealTimers());

  it("shows an Edit button for each task when canManage", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    expect(editButtons.length).toBe(tasks.length);
  });

  it("opens the edit modal with heading 'Edit Task' when Edit is clicked", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("heading", { name: "Edit Task" })).toBeInTheDocument();
  });

  it("pre-fills the title field with the task's current title", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    const modal = screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
    expect(within(modal).getByPlaceholderText(/book venue/i)).toHaveValue("Book venue");
  });

  it("pre-fills the priority select with the task's current priority", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    const modal = screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
    expect(within(modal).getByDisplayValue("High")).toBeInTheDocument();
  });

  it("pre-fills the notes textarea with the task's current notes", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    const modal = screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
    expect(within(modal).getByRole("textbox", { name: /notes/i })).toHaveValue("Ask for discount");
  });

  it("closes the modal without calling updateTask when Cancel is clicked", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { name: "Edit Task" })).not.toBeInTheDocument();
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edit modal — save
// ---------------------------------------------------------------------------
describe("Planning — edit save", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    mockLifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: { ...tasks[0], title: "Updated venue" } });
  });
  afterEach(() => vi.useRealTimers());

  it("calls updateTask with the edited values on Save Changes", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));

    const modal = screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
    const titleInput = within(modal).getByPlaceholderText(/book venue/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated venue");

    await userEvent.selectOptions(within(modal).getByRole("combobox", { name: /priority/i }), "low");

    await userEvent.click(within(modal).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith("t1", expect.objectContaining({
        title: "Updated venue",
        priority: "low",
      }))
    );
  });

  it("closes the modal after a successful save", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Edit Task" })).not.toBeInTheDocument()
    );
  });

  it("shows a validation error and does not call updateTask when title is cleared", async () => {
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));

    const modal = screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
    await userEvent.clear(within(modal).getByPlaceholderText(/book venue/i));
    fireEvent.submit(modal.querySelector("form"));

    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("shows an error banner when the API call fails", async () => {
    api.updateTask.mockRejectedValue(new Error("Server error"));
    renderPage();
    await screen.findByText("Book venue");
    const row = screen.getByText("Book venue").closest("li");
    await userEvent.click(within(row).getByRole("button", { name: /edit/i }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Optimistic toggle rollback
// ---------------------------------------------------------------------------
describe("Planning — optimistic toggle rollback", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    mockLifeSpace();
  });
  afterEach(() => vi.useRealTimers());

  it("optimistically checks the box before the API responds", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");
    await userEvent.click(within(row).getByRole("checkbox"));
    expect(within(row).getByRole("checkbox")).toBeChecked();
  });

  it("rolls back the checkbox when the API call fails", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockRejectedValue(new Error("Network failure"));
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");
    expect(within(row).getByRole("checkbox")).not.toBeChecked();

    await userEvent.click(within(row).getByRole("checkbox"));

    await waitFor(() => expect(within(row).getByRole("checkbox")).not.toBeChecked());
  });

  it("shows an error message after a failed toggle", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockRejectedValue(new Error("Network failure"));
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");
    await userEvent.click(within(row).getByRole("checkbox"));
    expect(await screen.findByText(/could not update/i)).toBeInTheDocument();
  });

  it("does not show an error message after a successful toggle", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: { ...tasks[0], completed: true } });
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");
    await userEvent.click(within(row).getByRole("checkbox"));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(screen.queryByText(/could not update/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Create modal — priority field
// ---------------------------------------------------------------------------
describe("Planning — create modal priority", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    mockLifeSpace();
    api.listTasks.mockResolvedValue({ tasks: [] });
    api.createTask.mockResolvedValue({ task: { id: "new1" } });
  });
  afterEach(() => vi.useRealTimers());

  it("includes a priority select in the Add Task modal defaulting to Medium", async () => {
    renderPage();
    await screen.findByText(/no tasks yet/i);
    await userEvent.click(screen.getByRole("button", { name: /add task/i }));
    expect(screen.getByDisplayValue("Medium")).toBeInTheDocument();
  });

  it("submits the selected priority when creating a task", async () => {
    renderPage();
    await screen.findByText(/no tasks yet/i);
    await userEvent.click(screen.getByRole("button", { name: /add task/i }));

    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/book venue/i), "New task");
    await userEvent.selectOptions(within(modal).getByRole("combobox", { name: /priority/i }), "high");
    await userEvent.click(within(modal).getByRole("button", { name: /^add task$/i }));

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith("ls1", expect.objectContaining({ priority: "high" }))
    );
  });
});

// ---------------------------------------------------------------------------
// RBAC — edit controls hidden for non-managers
// ---------------------------------------------------------------------------
describe("Planning — RBAC edit controls", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    api.listTasks.mockResolvedValue({ tasks });
  });
  afterEach(() => vi.useRealTimers());

  it("hides Edit buttons for a volunteer", async () => {
    mockLifeSpace("volunteer");
    renderPage();
    await screen.findByText("Book venue");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("hides Edit buttons for a finance_manager (no task:manage)", async () => {
    mockLifeSpace("finance_manager");
    renderPage();
    await screen.findByText("Book venue");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("shows Edit buttons for an event_planner (has task:manage)", async () => {
    mockLifeSpace("event_planner");
    renderPage();
    await screen.findByText("Book venue");
    expect(screen.getAllByRole("button", { name: /edit/i }).length).toBeGreaterThan(0);
  });

  it("shows Edit buttons for an owner", async () => {
    mockLifeSpace("owner");
    renderPage();
    await screen.findByText("Book venue");
    expect(screen.getAllByRole("button", { name: /edit/i }).length).toBeGreaterThan(0);
  });
});
