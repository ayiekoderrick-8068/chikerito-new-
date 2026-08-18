import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Planning from "../../src/pages/Planning.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const tasks = [
  {
    id: "root", title: "Plan ceremony", category: "Venue", due_date: "2099-01-01",
    priority: "high", completed: false, notes: "", parent_task_id: null, depth: 0,
    dependencies: [], dependency_ids: [], blockers: [], blocked: false,
    subtask_progress: { total: 1, completed: 0, percent: 0 },
  },
  {
    id: "prerequisite", title: "Choose menu", category: "Catering", due_date: "2099-01-02",
    priority: "medium", completed: false, notes: "", parent_task_id: null, depth: 0,
    dependencies: [], dependency_ids: [], blockers: [], blocked: false,
    subtask_progress: { total: 0, completed: 0, percent: 0 }, unlocks_count: 1,
  },
  {
    id: "dependent", title: "Print menu", category: "Catering", due_date: "2099-01-03",
    priority: "medium", completed: false, notes: "Use ivory paper", parent_task_id: null, depth: 0,
    dependencies: [{ id: "prerequisite", title: "Choose menu", completed: false }],
    dependency_ids: ["prerequisite"],
    blockers: [{ id: "prerequisite", title: "Choose menu", completed: false }], blocked: true,
    subtask_progress: { total: 0, completed: 0, percent: 0 },
  },
  {
    id: "child", title: "Book officiant", category: "Venue", due_date: null,
    priority: "low", completed: false, notes: "", parent_task_id: "root", depth: 1,
    dependencies: [], dependency_ids: [], blockers: [], blocked: false,
    subtask_progress: { total: 0, completed: 0, percent: 0 },
  },
];

function lifeSpace(role = "owner") {
  useLifeSpace.mockReturnValue({
    currentId: "space-1",
    current: { id: "space-1", name: "Wedding", role },
    lifeSpaces: [{ id: "space-1", name: "Wedding", role }],
    selectLifeSpace: vi.fn(),
  });
}

function renderPage() {
  return render(<MemoryRouter><Planning /></MemoryRouter>);
}

async function openEdit(title) {
  renderPage();
  const row = (await screen.findByText(title)).closest("li");
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
  return screen.getByRole("heading", { name: "Edit Task" }).closest(".modal");
}

describe("Planning dependency and subtask presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: tasks[0] });
    api.createTask.mockResolvedValue({ task: { id: "created" } });
    api.addTaskDependency.mockResolvedValue({});
    api.removeTaskDependency.mockResolvedValue({});
    api.deleteTask.mockResolvedValue({});
  });

  it("renders a subtask with its parent name and hierarchy depth", async () => {
    renderPage();
    const row = (await screen.findByText("Book officiant")).closest("li");
    expect(row).toHaveClass("task-depth-1");
    expect(within(row).getByText("Subtask of Plan ceremony")).toBeInTheDocument();
  });

  it("renders recursive progress supplied by the backend", async () => {
    renderPage();
    const row = (await screen.findByText("Plan ceremony")).closest("li");
    expect(within(row).getByLabelText("Plan ceremony subtask progress")).toHaveTextContent("0/1 subtasks · 0%");
  });

  it("summarizes ready, blocked, and nested task counts", async () => {
    renderPage();
    const summary = await screen.findByRole("region", { name: "Task graph summary" });
    expect(summary).toHaveTextContent("3 ready to work on");
    expect(summary).toHaveTextContent("1 waiting on dependencies");
    expect(summary).toHaveTextContent("1 nested subtasks");
  });

  it("shows how many unfinished tasks a prerequisite unlocks", async () => {
    renderPage();
    const row = (await screen.findByText("Choose menu")).closest("li");
    expect(within(row).getByText("Unlocks 1 task")).toBeInTheDocument();
  });

  it("displays dependency names and a blocked badge", async () => {
    renderPage();
    const row = (await screen.findByText("Print menu")).closest("li");
    expect(within(row).getByText("Depends on Choose menu")).toBeInTheDocument();
    expect(within(row).getByText("Blocked")).toHaveAttribute("title", "Choose menu");
    expect(row).toHaveClass("blocked");
  });

  it("disables completion while a task is blocked", async () => {
    renderPage();
    const row = (await screen.findByText("Print menu")).closest("li");
    const checkbox = within(row).getByRole("checkbox", { name: "Complete Print menu" });
    expect(checkbox).toBeDisabled();
    await userEvent.click(checkbox);
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("leaves unblocked completion controls enabled for a manager", async () => {
    renderPage();
    const row = (await screen.findByText("Choose menu")).closest("li");
    expect(within(row).getByRole("checkbox", { name: "Complete Choose menu" })).toBeEnabled();
  });

  it("renders loading while the graph request is pending", () => {
    api.listTasks.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows a graph load error and retries", async () => {
    api.listTasks.mockRejectedValueOnce(new Error("Graph unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Graph unavailable");
    api.listTasks.mockResolvedValue({ tasks });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Plan ceremony")).toBeInTheDocument();
  });

  it("keeps the clear empty state for a life space without tasks", async () => {
    api.listTasks.mockResolvedValue({ tasks: [] });
    renderPage();
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("hides hierarchy mutation controls from volunteers", async () => {
    lifeSpace("volunteer");
    renderPage();
    await screen.findByText("Plan ceremony");
    expect(screen.queryByRole("button", { name: "+ Subtask" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Complete Plan ceremony" })).toBeDisabled();
  });
});

describe("Planning subtask creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.createTask.mockResolvedValue({ task: { id: "new-child" } });
    api.addTaskDependency.mockResolvedValue({});
  });

  it("opens the add form with parent and category inherited", async () => {
    renderPage();
    const row = (await screen.findByText("Plan ceremony")).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "+ Subtask" }));
    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    expect(within(modal).getByLabelText("Parent task")).toHaveValue("root");
    expect(within(modal).getByLabelText("Category")).toHaveValue("Venue");
  });

  it("creates a child with the selected parent", async () => {
    renderPage();
    const row = (await screen.findByText("Plan ceremony")).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "+ Subtask" }));
    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/book venue/i), "Confirm vows");
    await userEvent.click(within(modal).getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith("space-1", expect.objectContaining({
      title: "Confirm vows", parentTaskId: "root",
    })));
  });

  it("adds selected dependencies after creating the task", async () => {
    renderPage();
    await screen.findByText("Plan ceremony");
    await userEvent.click(screen.getByRole("button", { name: /^\+ Add Task$/ }));
    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/book venue/i), "Send invitations");
    await userEvent.click(within(modal).getByLabelText("Choose menu"));
    await userEvent.click(within(modal).getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(api.addTaskDependency).toHaveBeenCalledWith("new-child", "prerequisite"));
  });

  it("does not write dependency edges when none are selected", async () => {
    renderPage();
    await screen.findByText("Plan ceremony");
    await userEvent.click(screen.getByRole("button", { name: /^\+ Add Task$/ }));
    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/book venue/i), "Simple task");
    await userEvent.click(within(modal).getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(api.addTaskDependency).not.toHaveBeenCalled();
  });

  it("keeps the modal open and reports a create failure", async () => {
    api.createTask.mockRejectedValue(new Error("Invalid parent"));
    renderPage();
    await screen.findByText("Plan ceremony");
    await userEvent.click(screen.getByRole("button", { name: /^\+ Add Task$/ }));
    const modal = screen.getByRole("heading", { name: "Add Task" }).closest(".modal");
    await userEvent.type(within(modal).getByPlaceholderText(/book venue/i), "Broken task");
    await userEvent.click(within(modal).getByRole("button", { name: "Add Task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create task: Invalid parent");
    expect(screen.getByRole("heading", { name: "Add Task" })).toBeInTheDocument();
  });
});

describe("Planning dependency editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: tasks[2] });
    api.addTaskDependency.mockResolvedValue({});
    api.removeTaskDependency.mockResolvedValue({});
  });

  it("prefills parent and existing dependency selections", async () => {
    const modal = await openEdit("Print menu");
    expect(within(modal).getByLabelText("Parent task")).toHaveValue("");
    expect(within(modal).getByLabelText("Choose menu")).toBeChecked();
  });

  it("excludes the edited task from its own parent and dependency candidates", async () => {
    const modal = await openEdit("Print menu");
    expect(within(modal).queryByLabelText("Print menu")).not.toBeInTheDocument();
    expect(within(modal).getByLabelText("Parent task").querySelector('option[value="dependent"]')).toBeNull();
  });

  it("sends a changed parent in the task patch", async () => {
    const modal = await openEdit("Print menu");
    await userEvent.selectOptions(within(modal).getByLabelText("Parent task"), "root");
    await userEvent.click(within(modal).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("dependent", expect.objectContaining({ parentTaskId: "root" })));
  });

  it("removes an unchecked existing dependency", async () => {
    const modal = await openEdit("Print menu");
    await userEvent.click(within(modal).getByLabelText("Choose menu"));
    await userEvent.click(within(modal).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.removeTaskDependency).toHaveBeenCalledWith("dependent", "prerequisite"));
  });

  it("adds a newly checked dependency", async () => {
    const modal = await openEdit("Print menu");
    await userEvent.click(within(modal).getByLabelText("Plan ceremony"));
    await userEvent.click(within(modal).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(api.addTaskDependency).toHaveBeenCalledWith("dependent", "root"));
  });

  it("waits for relationship updates before closing and reloading", async () => {
    let resolveEdge;
    api.addTaskDependency.mockReturnValue(new Promise((resolve) => { resolveEdge = resolve; }));
    const modal = await openEdit("Print menu");
    await userEvent.click(within(modal).getByLabelText("Plan ceremony"));
    await userEvent.click(within(modal).getByRole("button", { name: "Save Changes" }));
    expect(screen.getByRole("heading", { name: "Edit Task" })).toBeInTheDocument();
    resolveEdge({});
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Task" })).not.toBeInTheDocument());
    expect(api.listTasks.mock.calls.length).toBeGreaterThan(1);
  });

  it("shows a dependency-cycle API error inside the editor", async () => {
    api.addTaskDependency.mockRejectedValue(new Error("Dependency would create a cycle"));
    const modal = await openEdit("Print menu");
    await userEvent.click(within(modal).getByLabelText("Plan ceremony"));
    await userEvent.click(within(modal).getByRole("button", { name: "Save Changes" }));
    expect(await within(modal).findByText(/would create a cycle/i)).toBeInTheDocument();
  });
});

describe("Planning optimistic graph interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifeSpace();
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: { ...tasks[1], completed: true } });
    api.deleteTask.mockResolvedValue({});
  });

  it("optimistically completes an unblocked prerequisite", async () => {
    api.updateTask.mockReturnValue(new Promise(() => {}));
    renderPage();
    const row = (await screen.findByText("Choose menu")).closest("li");
    await userEvent.click(within(row).getByRole("checkbox"));
    expect(within(row).getByRole("checkbox")).toBeChecked();
  });

  it("rolls back and names the task when completion is rejected", async () => {
    api.updateTask.mockRejectedValue(new Error("Still blocked"));
    renderPage();
    const row = (await screen.findByText("Choose menu")).closest("li");
    await userEvent.click(within(row).getByRole("checkbox"));
    await waitFor(() => expect(within(row).getByRole("checkbox")).not.toBeChecked());
    expect(screen.getByRole("alert")).toHaveTextContent('Could not update "Choose menu": Still blocked');
  });

  it("reports delete errors without removing the task locally", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteTask.mockRejectedValue(new Error("Referenced task"));
    renderPage();
    const row = (await screen.findByText("Plan ceremony")).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "✕" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete task: Referenced task");
    expect(screen.getByText("Plan ceremony")).toBeInTheDocument();
  });
});
