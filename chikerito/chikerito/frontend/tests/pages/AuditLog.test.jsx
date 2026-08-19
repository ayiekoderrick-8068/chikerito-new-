import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AuditLog, { eventDescription, formatTime, humanize } from "../../src/pages/AuditLog.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api", () => ({
  api: {
    listAuditLogs: vi.fn(),
    getAuditFilterOptions: vi.fn(),
  },
}));

vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

vi.mock("../../src/components/Topbar.jsx", () => ({
  default: ({ title }) => <header data-testid="topbar">{title}</header>,
}));

const baseLog = {
  id: "audit-1",
  life_space_id: "ls-1",
  actor_id: "user-1",
  actor_name: "Ada Owner",
  action: "expense.updated",
  resource_type: "expense",
  resource_id: "expense-1",
  metadata: {
    label: "Grand Hall",
    changed_fields: ["status", "paymentDate"],
    status: "pending",
  },
  occurred_at: "2026-06-10T12:30:00.000Z",
};

const options = {
  actions: ["expense.created", "expense.updated", "task.completed"],
  resourceTypes: ["expense", "task"],
  actors: [
    { id: "user-1", name: "Ada Owner" },
    { id: "user-2", name: "Nia Planner" },
  ],
};

function response(logs = [baseLog], page = {}) {
  return {
    auditLogs: logs,
    page: { limit: 25, hasMore: false, nextCursor: null, ...page },
  };
}

function mockContext(overrides = {}) {
  useLifeSpace.mockReturnValue({
    currentId: "ls-1",
    current: { id: "ls-1", title: "Wedding", role: "owner" },
    lifeSpaces: [{ id: "ls-1", title: "Wedding", role: "owner" }],
    ...overrides,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditLog />
    </MemoryRouter>
  );
}

describe("Activity Log access and loading states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext();
    api.getAuditFilterOptions.mockResolvedValue(options);
    api.listAuditLogs.mockResolvedValue(response());
  });

  it("prompts for a Life Space without calling either endpoint", () => {
    mockContext({ currentId: null, current: null, lifeSpaces: [] });
    renderPage();
    expect(screen.getByText("Create a Life Space to view its activity.")).toBeInTheDocument();
    expect(api.listAuditLogs).not.toHaveBeenCalled();
    expect(api.getAuditFilterOptions).not.toHaveBeenCalled();
  });

  it.each(["volunteer", "event_planner", "editor"])("denies the %s role in the UI", (role) => {
    mockContext({ current: { id: "ls-1", role } });
    renderPage();
    expect(screen.getByText(/available to owners and finance managers/i)).toBeInTheDocument();
    expect(api.listAuditLogs).not.toHaveBeenCalled();
  });

  it.each(["owner", "finance_manager"])("loads activity for the %s role", async (role) => {
    mockContext({ current: { id: "ls-1", role } });
    renderPage();
    expect(await screen.findByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
    expect(api.listAuditLogs).toHaveBeenCalledWith("ls-1", expect.objectContaining({ limit: 25 }));
  });

  it("shows an accessible loading state until the first page resolves", async () => {
    let resolveRequest;
    api.listAuditLogs.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading activity");
    resolveRequest(response());
    expect(await screen.findByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
  });

  it("shows an unfiltered empty state with useful guidance", async () => {
    api.listAuditLogs.mockResolvedValue(response([]));
    renderPage();
    expect(await screen.findByRole("heading", { name: "No activity yet" })).toBeInTheDocument();
    expect(screen.getByText(/Important changes will appear here/i)).toBeInTheDocument();
  });

  it("shows a request error and retries the same query", async () => {
    api.listAuditLogs
      .mockRejectedValueOnce(new Error("Audit service unavailable"))
      .mockResolvedValueOnce(response());
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Audit service unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
    expect(api.listAuditLogs).toHaveBeenCalledTimes(2);
  });

  it("continues loading logs if filter-option discovery fails", async () => {
    api.getAuditFilterOptions.mockRejectedValue(new Error("No options"));
    renderPage();
    expect(await screen.findByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Action" })).toHaveValue("");
  });
});

describe("Activity Log rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext();
    api.getAuditFilterOptions.mockResolvedValue(options);
    api.listAuditLogs.mockResolvedValue(response());
  });

  it("renders action, label, actor, resource, timestamp, and safe metadata", async () => {
    renderPage();
    const history = await screen.findByRole("region", { name: "Activity history" });
    expect(within(history).getByText("Expense Updated: Grand Hall")).toBeInTheDocument();
    expect(within(history).getByText("By Ada Owner · Expense")).toBeInTheDocument();
    expect(within(history).getByText(/Fields: Status, Payment Date/)).toBeInTheDocument();
    expect(within(history).getByText(/Status: Pending/)).toBeInTheDocument();
    expect(within(history).getByRole("time")).toHaveAttribute("datetime", baseLog.occurred_at);
  });

  it("renders records with no optional label or metadata", async () => {
    api.listAuditLogs.mockResolvedValue(response([{
      ...baseLog,
      id: "plain",
      action: "task.deleted",
      resource_type: "task",
      metadata: {},
    }]));
    renderPage();
    expect(await screen.findByText("Task Deleted")).toBeInTheDocument();
    expect(screen.getByText("By Ada Owner · Task")).toBeInTheDocument();
    expect(screen.queryByText(/^Fields:/)).not.toBeInTheDocument();
  });

  it("uses a safe fallback for an invalid stored timestamp", async () => {
    api.listAuditLogs.mockResolvedValue(response([{ ...baseLog, occurred_at: "broken" }]));
    renderPage();
    expect(await screen.findByText("Unknown time")).toBeInTheDocument();
  });

  it("renders a metadata role when an invitation or member role changes", async () => {
    api.listAuditLogs.mockResolvedValue(response([{
      ...baseLog,
      id: "role",
      action: "team_member.role_updated",
      resource_type: "team_member",
      metadata: { role: "finance_manager", changed_fields: ["role"] },
    }]));
    renderPage();
    expect(await screen.findByText(/Role: Finance Manager/)).toBeInTheDocument();
  });

  it("renders records in the order supplied by the deterministic API", async () => {
    api.listAuditLogs.mockResolvedValue(response([
      { ...baseLog, id: "new", metadata: { label: "Newest" } },
      { ...baseLog, id: "old", metadata: { label: "Oldest" } },
    ]));
    renderPage();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Newest");
    expect(items[1]).toHaveTextContent("Oldest");
  });
});

describe("Activity Log filtering and pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext();
    api.getAuditFilterOptions.mockResolvedValue(options);
    api.listAuditLogs.mockResolvedValue(response());
  });

  it("populates deterministic action, resource, and actor filter options", async () => {
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    expect(screen.getByRole("option", { name: "Expense Created" })).toHaveValue("expense.created");
    expect(screen.getByRole("option", { name: "Task" })).toHaveValue("task");
    expect(screen.getByRole("option", { name: "Nia Planner" })).toHaveValue("user-2");
  });

  it("applies all five filter values together", async () => {
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Action" }), "expense.updated");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Resource" }), "expense");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Actor" }), "user-1");
    await userEvent.type(screen.getByLabelText("From"), "2026-06-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-06-30");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(api.listAuditLogs).toHaveBeenLastCalledWith("ls-1", {
      action: "expense.updated",
      resourceType: "expense",
      actorId: "user-1",
      from: "2026-06-01",
      to: "2026-06-30",
      cursor: null,
      limit: 25,
    }));
    expect(screen.getByText("5 active filters")).toBeInTheDocument();
  });

  it("clears staged and applied filters", async () => {
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Action" }), "expense.updated");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("1 active filter")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByText("1 active filter")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Action" })).toHaveValue("");
    expect(api.listAuditLogs).toHaveBeenLastCalledWith("ls-1", expect.objectContaining({ action: "" }));
  });

  it("offers filter clearing from a filtered empty state", async () => {
    api.listAuditLogs
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response());
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Action" }), "task.completed");
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("heading", { name: "No matching activity" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
  });

  it("loads the next cursor page and appends records", async () => {
    api.listAuditLogs
      .mockResolvedValueOnce(response([baseLog], { hasMore: true, nextCursor: "cursor-1" }))
      .mockResolvedValueOnce(response([{ ...baseLog, id: "audit-2", metadata: { label: "Second" } }]));
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText(/Expense Updated: Second/i)).toBeInTheDocument();
    expect(api.listAuditLogs).toHaveBeenLastCalledWith("ls-1", expect.objectContaining({ cursor: "cursor-1" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("disables the pagination button and announces progress while appending", async () => {
    let resolveMore;
    api.listAuditLogs
      .mockResolvedValueOnce(response([baseLog], { hasMore: true, nextCursor: "cursor-1" }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveMore = resolve; }));
    renderPage();
    const button = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Loading more…" })).toBeDisabled();
    resolveMore(response([]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading more…" })).not.toBeInTheDocument());
  });

  it("preserves existing entries and exposes retry when a later page fails", async () => {
    api.listAuditLogs
      .mockResolvedValueOnce(response([baseLog], { hasMore: true, nextCursor: "cursor-1" }))
      .mockRejectedValueOnce(new Error("Next page failed"));
    renderPage();
    await screen.findByText(/Expense Updated: Grand Hall/i);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Next page failed");
    expect(screen.getByText(/Expense Updated: Grand Hall/i)).toBeInTheDocument();
  });
});

describe("Activity Log formatting helpers", () => {
  it("humanizes dot-separated and underscore-separated identifiers", () => {
    expect(humanize("team_member.role_updated")).toBe("Team Member Role Updated");
    expect(humanize("")).toBe("");
  });

  it("builds event descriptions with and without labels", () => {
    expect(eventDescription(baseLog)).toBe("Expense Updated: Grand Hall");
    expect(eventDescription({ ...baseLog, metadata: {} })).toBe("Expense Updated");
  });

  it("formats valid dates and safely handles invalid dates", () => {
    expect(formatTime("broken")).toBe("Unknown time");
    expect(formatTime("2026-06-10T12:30:00.000Z")).not.toBe("Unknown time");
  });
});
