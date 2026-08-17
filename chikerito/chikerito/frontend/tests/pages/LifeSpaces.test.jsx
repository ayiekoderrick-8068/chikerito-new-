import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LifeSpaces from "../../src/pages/LifeSpaces.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const pendingInvitation = {
  id: "inv1",
  life_space_id: "ls-new",
  role: "editor",
  lifeSpaceTitle: "Ada's Wedding",
  status: "pending",
};

function mockLifeSpace(overrides = {}) {
  useLifeSpace.mockReturnValue({
    lifeSpaces: [],
    currentId: null,
    refresh: vi.fn(),
    selectLifeSpace: vi.fn(),
    ...overrides,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LifeSpaces />
    </MemoryRouter>
  );
}

describe("LifeSpaces — pending invitations", () => {
  beforeEach(() => {
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [] });
  });

  it("shows nothing invitation-related when there are none pending", async () => {
    mockLifeSpace();
    renderPage();
    await waitFor(() => expect(api.listPendingInvitationsForMe).toHaveBeenCalled());
    expect(screen.queryByText(/pending invitations/i)).not.toBeInTheDocument();
  });

  it("shows a pending invitation with the life space title and role", async () => {
    mockLifeSpace();
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [pendingInvitation] });
    renderPage();

    expect(await screen.findByText("Ada's Wedding")).toBeInTheDocument();
    expect(screen.getByText(/as editor/i)).toBeInTheDocument();
  });

  it("shows an error banner if loading invitations fails", async () => {
    mockLifeSpace();
    api.listPendingInvitationsForMe.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("accepting refreshes life spaces, selects the new one, and removes it from the pending list", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const selectLifeSpace = vi.fn();
    mockLifeSpace({ refresh, selectLifeSpace });
    api.listPendingInvitationsForMe
      .mockResolvedValueOnce({ invitations: [pendingInvitation] })
      .mockResolvedValueOnce({ invitations: [] });
    api.acceptInvitation.mockResolvedValue({ invitation: { ...pendingInvitation, status: "accepted" } });
    renderPage();
    await screen.findByText("Ada's Wedding");

    await userEvent.click(screen.getByRole("button", { name: /accept/i }));

    expect(api.acceptInvitation).toHaveBeenCalledWith("inv1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(selectLifeSpace).toHaveBeenCalledWith("ls-new");
    await waitFor(() => expect(screen.queryByText("Ada's Wedding")).not.toBeInTheDocument());
  });

  it("declining removes it from the pending list without touching life spaces", async () => {
    const refresh = vi.fn();
    mockLifeSpace({ refresh });
    api.listPendingInvitationsForMe
      .mockResolvedValueOnce({ invitations: [pendingInvitation] })
      .mockResolvedValueOnce({ invitations: [] });
    api.declineInvitation.mockResolvedValue({ invitation: { ...pendingInvitation, status: "declined" } });
    renderPage();
    await screen.findByText("Ada's Wedding");

    await userEvent.click(screen.getByRole("button", { name: /decline/i }));

    expect(api.declineInvitation).toHaveBeenCalledWith("inv1");
    await waitFor(() => expect(screen.queryByText("Ada's Wedding")).not.toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("LifeSpaces — existing list/create behavior", () => {
  beforeEach(() => {
    api.listPendingInvitationsForMe.mockResolvedValue({ invitations: [] });
  });

  it("shows the empty state with no life spaces", async () => {
    mockLifeSpace({ lifeSpaces: [] });
    renderPage();
    expect(await screen.findByText(/no life spaces yet/i)).toBeInTheDocument();
  });

  it("lists existing life spaces and marks the active one", async () => {
    mockLifeSpace({
      lifeSpaces: [
        { id: "ls1", title: "Wedding", milestone_type: "wedding", story: "", goal_amount: 5000 },
        { id: "ls2", title: "Graduation", milestone_type: "graduation", story: "", goal_amount: 1000 },
      ],
      currentId: "ls1",
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Wedding" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Graduation" })).toBeInTheDocument();
    expect(screen.getByText("✓ Active")).toBeInTheDocument();
  });

  it("creates a life space and selects it", async () => {
    const refresh = vi.fn();
    const selectLifeSpace = vi.fn();
    mockLifeSpace({ lifeSpaces: [], refresh, selectLifeSpace });
    api.createLifeSpace.mockResolvedValue({ lifeSpace: { id: "ls3" } });
    renderPage();
    await screen.findByText(/no life spaces yet/i);

    await userEvent.click(screen.getByRole("button", { name: /create life space/i }));
    await userEvent.type(screen.getByPlaceholderText(/clinton & mary/i), "Our Wedding");
    await userEvent.click(screen.getByRole("button", { name: /^create life space$/i }));

    await waitFor(() => expect(api.createLifeSpace).toHaveBeenCalledWith(expect.objectContaining({ title: "Our Wedding" })));
    expect(selectLifeSpace).toHaveBeenCalledWith("ls3");
  });
});
