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

describe("Team — role-based guards", () => {
  beforeEach(() => {
    api.listTeam.mockResolvedValue({ team });
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
});
