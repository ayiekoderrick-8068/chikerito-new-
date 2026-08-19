import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LifeSpaces from "../../src/pages/LifeSpaces.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const activeOwner = {
  id: "active-owner", title: "Active Wedding", milestone_type: "wedding", story: "Planning",
  goal_amount: 5000, slug: "active-wedding", status: "active", role: "owner",
};
const archivedOwner = {
  id: "archived-owner", title: "Archived Graduation", milestone_type: "graduation", story: "Finished",
  goal_amount: 2000, slug: "archived-graduation", status: "archived", role: "owner",
  archived_at: "2099-01-01T00:00:00.000Z",
};
const archivedMember = {
  id: "archived-member", title: "Archived Community", milestone_type: "community", story: "Read only",
  goal_amount: 1000, slug: "archived-community", status: "archived", role: "volunteer",
};
const allSpaces = [activeOwner, archivedOwner, archivedMember];

function context(overrides = {}) {
  useLifeSpace.mockReturnValue({
    lifeSpaces: [activeOwner],
    currentId: activeOwner.id,
    current: activeOwner,
    refresh: vi.fn().mockResolvedValue(),
    selectLifeSpace: vi.fn(),
    ...overrides,
  });
}

function renderPage() {
  return render(<MemoryRouter><LifeSpaces /></MemoryRouter>);
}

async function archivedCard(title = "Archived Graduation") {
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest(".life-space-card");
}

describe("Life Space lifecycle listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context();
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [] });
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: allSpaces });
    api.archiveLifeSpace.mockResolvedValue({ lifeSpace: archivedOwner });
    api.restoreLifeSpace.mockResolvedValue({ lifeSpace: activeOwner });
  });

  it("loads all statuses independently from the active application context", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Active Wedding" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived Graduation" })).toBeInTheDocument();
    expect(api.listLifeSpaces).toHaveBeenCalledWith({ status: "all" });
  });

  it("shows a loading state when neither context nor lifecycle data is ready", () => {
    context({ lifeSpaces: [], currentId: null, current: null });
    api.listLifeSpaces.mockReturnValue(new Promise(() => {}));
    api.listPendingInvitationsForMe.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading life spaces");
  });

  it("reports lifecycle loading errors and retries", async () => {
    api.listLifeSpaces.mockRejectedValueOnce(new Error("Lifecycle unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Lifecycle unavailable");
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: allSpaces });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Archived Graduation" })).toBeInTheDocument();
  });

  it("filters to active spaces", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Archived Graduation" });
    await userEvent.click(within(screen.getByRole("group", { name: "Life space status filter" })).getByRole("button", { name: "Active" }));
    expect(screen.getByRole("heading", { name: "Active Wedding" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Archived Graduation" })).not.toBeInTheDocument();
  });

  it("filters to archived spaces and reports the count", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Active Wedding" });
    await userEvent.click(screen.getByRole("button", { name: "Archived (2)" }));
    expect(screen.queryByRole("heading", { name: "Active Wedding" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived Graduation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived Community" })).toBeInTheDocument();
  });

  it("shows a clear archived empty state", async () => {
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: [activeOwner] });
    renderPage();
    await screen.findByRole("heading", { name: "Active Wedding" });
    await userEvent.click(screen.getByRole("button", { name: "Archived (0)" }));
    expect(screen.getByRole("heading", { name: "No archived Life Spaces" })).toBeInTheDocument();
    expect(screen.getByText(/can be restored/i)).toBeInTheDocument();
  });

  it("marks archived cards and disables activation", async () => {
    const card = await (renderPage(), archivedCard());
    expect(card).toHaveClass("life-space-archived");
    expect(within(card).getByText("Archived")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Set Active" })).toBeDisabled();
  });

  it("hides public share actions for archived spaces", async () => {
    renderPage();
    const card = await archivedCard();
    expect(within(card).queryByRole("button", { name: "Copy Share Link" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Active Wedding" }).closest(".life-space-card")).getByRole("button", { name: "Copy Share Link" })).toBeInTheDocument();
  });

  it("shows no restore or delete controls to a non-owner member", async () => {
    renderPage();
    const card = await archivedCard("Archived Community");
    expect(within(card).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Leave Life Space" })).toBeInTheDocument();
  });

  it("renders lifecycle summary counts from the API", async () => {
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: allSpaces, summary: { total: 3, active: 1, archived: 2, owned: 2, shared: 1 } });
    renderPage();
    const summary = await screen.findByRole("region", { name: "Life space lifecycle summary" });
    expect(summary).toHaveTextContent("1 active");
    expect(summary).toHaveTextContent("2 archived");
    expect(summary).toHaveTextContent("2 owned");
    expect(summary).toHaveTextContent("1 shared with you");
  });
});

describe("Life Space archive and restore actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context();
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [] });
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: allSpaces });
    api.archiveLifeSpace.mockResolvedValue({ lifeSpace: archivedOwner });
    api.restoreLifeSpace.mockResolvedValue({ lifeSpace: activeOwner });
  });

  it("opens an accessible archive confirmation and cancels safely", async () => {
    renderPage();
    const card = (await screen.findByRole("heading", { name: "Active Wedding" })).closest(".life-space-card");
    await userEvent.click(within(card).getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("read-only access");
    expect(dialog).toHaveTextContent("Pending invitations will be revoked");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.archiveLifeSpace).not.toHaveBeenCalled();
  });

  it("archives with a trimmed reason, refreshes context, and reloads lifecycle data", async () => {
    const refresh = vi.fn().mockResolvedValue();
    context({ refresh });
    renderPage();
    const card = (await screen.findByRole("heading", { name: "Active Wedding" })).closest(".life-space-card");
    await userEvent.click(within(card).getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "  Event completed  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive Life Space" }));
    await waitFor(() => expect(api.archiveLifeSpace).toHaveBeenCalledWith("active-owner", { reason: "Event completed" }));
    expect(refresh).toHaveBeenCalled();
    expect(api.listLifeSpaces.mock.calls.length).toBeGreaterThan(1);
  });

  it("reports an archive failure without hiding the card", async () => {
    api.archiveLifeSpace.mockRejectedValue(new Error("Archive conflict"));
    renderPage();
    const card = (await screen.findByRole("heading", { name: "Active Wedding" })).closest(".life-space-card");
    await userEvent.click(within(card).getByRole("button", { name: "Archive" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive Life Space" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive conflict");
    expect(screen.getByRole("heading", { name: "Active Wedding" })).toBeInTheDocument();
  });

  it("restores, refreshes, and selects the restored life space", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const selectLifeSpace = vi.fn();
    context({ refresh, selectLifeSpace });
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreLifeSpace).toHaveBeenCalledWith("archived-owner"));
    expect(refresh).toHaveBeenCalled();
    expect(selectLifeSpace).toHaveBeenCalledWith("archived-owner");
  });

  it("reports restore errors and keeps the archived controls", async () => {
    api.restoreLifeSpace.mockRejectedValue(new Error("Restore denied"));
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Restore denied");
    expect(within(card).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("lets a non-owner leave after explicit confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.leaveLifeSpace.mockResolvedValue({});
    renderPage();
    const card = await archivedCard("Archived Community");
    await userEvent.click(within(card).getByRole("button", { name: "Leave Life Space" }));
    await waitFor(() => expect(api.leaveLifeSpace).toHaveBeenCalledWith("archived-member"));
    expect(useLifeSpace.mock.results.at(-1).value.refresh).toHaveBeenCalled();
  });

  it("does not leave when a member cancels confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    const card = await archivedCard("Archived Community");
    await userEvent.click(within(card).getByRole("button", { name: "Leave Life Space" }));
    expect(api.leaveLifeSpace).not.toHaveBeenCalled();
  });
});

describe("Life Space controlled permanent deletion", () => {
  const impact = {
    counts: { team_members: 3, invitations: 1, budget_categories: 2, contributions: 4, expenses: 5, recurring_expenses: 1, tasks: 7, notifications: 2 },
    dependentRecords: 19,
    requiresArchive: true,
    requiresConfirmation: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    context();
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [] });
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: allSpaces });
    api.getLifeSpaceDeletionImpact.mockResolvedValue({ impact });
    api.deleteLifeSpace.mockResolvedValue({});
  });

  it("loads deletion impact before opening confirmation", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(api.getLifeSpaceDeletionImpact).toHaveBeenCalledWith("archived-owner"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows affected resource counts in the confirmation dialog", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("budget categories").nextSibling).toHaveTextContent("2");
    expect(within(dialog).getByText("expenses").nextSibling).toHaveTextContent("5");
    expect(within(dialog).getByText("tasks").nextSibling).toHaveTextContent("7");
  });

  it("requires the exact title before enabling permanent deletion", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    const button = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(button).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/type archived graduation/i), "wrong");
    expect(button).toBeDisabled();
  });

  it("submits both confirmation flags after an exact title match", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/type archived graduation/i), "Archived Graduation");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(api.deleteLifeSpace).toHaveBeenCalledWith("archived-owner", {
      confirmDelete: true, confirmationTitle: "Archived Graduation",
    }));
  });

  it("closes the deletion dialog after success and reloads both lists", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/type archived graduation/i), "Archived Graduation");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.listLifeSpaces.mock.calls.length).toBeGreaterThan(1);
  });

  it("cancels without deleting", async () => {
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.deleteLifeSpace).not.toHaveBeenCalled();
  });

  it("reports deletion-impact failures without opening a destructive dialog", async () => {
    api.getLifeSpaceDeletionImpact.mockRejectedValue(new Error("Impact unavailable"));
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Impact unavailable");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports deletion failures and keeps the confirmation dialog", async () => {
    api.deleteLifeSpace.mockRejectedValue(new Error("Deletion rejected"));
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/type archived graduation/i), "Archived Graduation");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deletion rejected");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("allows immediate deletion when impact says no title confirmation is needed", async () => {
    api.getLifeSpaceDeletionImpact.mockResolvedValue({ impact: { ...impact, dependentRecords: 0, requiresArchive: false, requiresConfirmation: false } });
    renderPage();
    const card = await archivedCard();
    await userEvent.click(within(card).getByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(api.deleteLifeSpace).toHaveBeenCalledWith("archived-owner", {}));
  });
});
