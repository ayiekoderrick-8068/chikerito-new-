import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Team from "../../src/pages/Team.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

const team = [
  { id: "m0", user_id: "u0", name: "Owner Person", email: "owner@chikerito.test", role: "owner" },
  { id: "m1", user_id: "u1", name: "Helper Person", email: "helper@chikerito.test", role: "volunteer" },
];

function mockLifeSpace(role) {
  useLifeSpace.mockReturnValue({
    lifeSpaces: [],
    selectLifeSpace: vi.fn(),
    currentId: "ls1",
    current: { id: "ls1", role },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>
  );
}

const invitations = [
  { id: "i1", email: "pending@chikerito.test", role: "editor", status: "pending", expires_at: new Date(Date.now() + 3 * 86400000).toISOString() },
];

describe("Team — role-based guards", () => {
  beforeEach(() => {
    api.listTeam.mockResolvedValue({ team });
    api.listInvitations.mockResolvedValue({ invitations: [] });
  });

  it("owner sees the invite form and manage controls, but never for the owner's own row", async () => {
    mockLifeSpace("owner");
    renderPage();
    await screen.findByText("Helper Person");

    expect(screen.getByText("Invite a Collaborator")).toBeInTheDocument();
    const ownerRow = screen.getByText("Owner Person").closest("tr");
    const helperRow = screen.getByText("Helper Person").closest("tr");
    expect(within(ownerRow).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(within(ownerRow).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(helperRow).getByRole("button", { name: /remove/i })).toBeInTheDocument();
    expect(within(helperRow).getByRole("combobox")).toBeInTheDocument();
  });

  it("a non-owner role never sees the invite form or any manage controls", async () => {
    mockLifeSpace("finance_manager");
    renderPage();
    await screen.findByText("Helper Person");

    expect(screen.queryByText("Invite a Collaborator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("changing a member's role calls the update endpoint", async () => {
    mockLifeSpace("owner");
    api.updateTeamMemberRole.mockResolvedValue({ member: { ...team[1], role: "editor" } });
    renderPage();
    await screen.findByText("Helper Person");

    const helperRow = screen.getByText("Helper Person").closest("tr");
    await userEvent.selectOptions(within(helperRow).getByRole("combobox"), "editor");

    await waitFor(() => expect(api.updateTeamMemberRole).toHaveBeenCalledWith("ls1", "m1", "editor"));
  });

  it("removing a member asks for confirmation and calls the remove endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockLifeSpace("owner");
    api.removeTeamMember.mockResolvedValue({});
    renderPage();
    await screen.findByText("Helper Person");

    const helperRow = screen.getByText("Helper Person").closest("tr");
    await userEvent.click(within(helperRow).getByRole("button", { name: /remove/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.removeTeamMember).toHaveBeenCalledWith("ls1", "m1"));
  });

  it("submitting the invite form calls createInvitation", async () => {
    mockLifeSpace("owner");
    api.createInvitation.mockResolvedValue({ invitation: { id: "i2" } });
    renderPage();
    await screen.findByText("Helper Person");

    await userEvent.type(document.querySelector('input[type="email"]'), "new@chikerito.test");
    await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));

    await waitFor(() =>
      expect(api.createInvitation).toHaveBeenCalledWith("ls1", { email: "new@chikerito.test", role: "volunteer" })
    );
  });
});

describe("Team — pending invitations", () => {
  beforeEach(() => {
    api.listTeam.mockResolvedValue({ team });
  });

  it("shows an empty state when there are none", async () => {
    mockLifeSpace("owner");
    api.listInvitations.mockResolvedValue({ invitations: [] });
    renderPage();
    expect(await screen.findByText(/no pending invitations/i)).toBeInTheDocument();
  });

  it("lists pending invitations with email, role, and expiry, and lets the owner revoke", async () => {
    mockLifeSpace("owner");
    api.listInvitations.mockResolvedValue({ invitations });
    api.revokeInvitation.mockResolvedValue({});
    renderPage();
    await screen.findByText("pending@chikerito.test");
    expect(screen.getByText(/expires in 3 days/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith("ls1", "i1"));
  });

  it("a non-owner can see pending invitations but not revoke them", async () => {
    mockLifeSpace("finance_manager");
    api.listInvitations.mockResolvedValue({ invitations });
    renderPage();
    await screen.findByText("pending@chikerito.test");
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("shows an error banner if loading invitations fails", async () => {
    mockLifeSpace("owner");
    api.listInvitations.mockRejectedValue(new Error("Network error"));
    renderPage();
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});
