import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Planning from "../../src/pages/Planning.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter>
      <Planning />
    </MemoryRouter>
  );
}

const tasks = [
  { id: "t1", title: "Book venue", category: "Venue", due_date: "2026-06-20", completed: false, notes: "" },
  { id: "t2", title: "Order cake", category: "Catering", due_date: "2026-05-01", completed: false, notes: "" }, // overdue relative to fixed "now" below
  { id: "t3", title: "Pick songs", category: "Music", due_date: null, completed: true, notes: "" },
];

describe("Planning", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prompts to create a life space when there is none yet", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null });
    renderPage();
    expect(screen.getByText(/create a life space first/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no tasks", async () => {
    api.listTasks.mockResolvedValue({ tasks: [] });
    renderPage();
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("computes completion, overdue, and progress stats", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    renderPage();
    await screen.findByText("Book venue");

    expect(screen.getByText("1/3")).toBeInTheDocument(); // done/total
    expect(screen.getAllByText("1")[0]).toBeInTheDocument(); // overdue count
    expect(screen.getByText("33%")).toBeInTheDocument(); // 1/3 rounded
  });

  it("flags a past-due, incomplete task as overdue in the timeline view", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    renderPage();
    expect(await screen.findByText(/overdue/)).toBeInTheDocument();
  });

  it("switches to the checklist view, grouped by category", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    renderPage();
    await screen.findByText("Book venue");

    await userEvent.click(screen.getByRole("button", { name: /checklist/i }));

    const categoryHeaders = Array.from(document.querySelectorAll(".cat-name")).map((el) => el.textContent);
    expect(categoryHeaders).toEqual(expect.arrayContaining(["Venue", "Catering", "Music"]));
  });

  it("toggles a task's completion optimistically and persists it", async () => {
    api.listTasks.mockResolvedValue({ tasks });
    api.updateTask.mockResolvedValue({ task: { ...tasks[0], completed: true } });
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");

    await userEvent.click(within(row).getByRole("checkbox"));

    expect(within(row).getByRole("checkbox")).toBeChecked();
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("t1", { completed: true }));
  });

  it("adds a new task", async () => {
    api.listTasks.mockResolvedValue({ tasks: [] });
    api.createTask.mockResolvedValue({ task: { id: "t4" } });
    renderPage();
    await screen.findByText(/no tasks yet/i);

    await userEvent.click(screen.getByRole("button", { name: /add task/i }));
    await userEvent.type(screen.getByPlaceholderText(/book venue/i), "Send invitations");
    await userEvent.click(screen.getByRole("button", { name: /^add task$/i }));

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith(
        "ls1",
        expect.objectContaining({ title: "Send invitations", category: "General" })
      )
    );
  });

  it("deletes a task after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.listTasks.mockResolvedValue({ tasks });
    api.deleteTask.mockResolvedValue({});
    renderPage();
    const row = (await screen.findByText("Book venue")).closest("li");

    await userEvent.click(within(row).getByRole("button", { name: "✕" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteTask).toHaveBeenCalledWith("t1"));
  });
});
