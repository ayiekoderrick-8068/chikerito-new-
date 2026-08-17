import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Settings from "../../src/pages/Settings.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";
import { useAuth } from "../../src/context/AuthContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));
vi.mock("../../src/context/AuthContext.jsx", () => ({ useAuth: vi.fn() }));

const baseSpace = {
  id: "ls1",
  title: "Ada's Wedding",
  goal_amount: 5000,
  story: "",
  cover_image: null,
  visibility: "private",
  show_budget_public: false,
  allow_indexing: false,
  hasPasscode: false,
  slug: "ada-wedding",
};

function mockLifeSpace(role) {
  useLifeSpace.mockReturnValue({
    lifeSpaces: [],
    selectLifeSpace: vi.fn(),
    currentId: "ls1",
    current: { ...baseSpace, role },
    refresh: vi.fn(),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  );
}

describe("Settings — role-based guards", () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { firstName: "Ada", lastName: "L", email: "ada@chikerito.test" } });
    api.listSessions.mockResolvedValue({ sessions: [] });
  });

  it("owner sees the full form, including visibility/passcode", async () => {
    mockLifeSpace("owner");
    renderPage();
    expect(screen.getByText("Event Visibility")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    await screen.findByText("Security");
  });

  it("finance_manager (edit_settings but not edit_visibility) sees the form without the visibility section", async () => {
    mockLifeSpace("finance_manager");
    renderPage();
    expect(screen.queryByText("Event Visibility")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    await screen.findByText("Security");
  });

  it("editor (edit_settings but not edit_visibility) also sees the form without the visibility section", async () => {
    mockLifeSpace("editor");
    renderPage();
    expect(screen.queryByText("Event Visibility")).not.toBeInTheDocument();
    await screen.findByText("Security");
  });

  it("volunteer (no edit_settings at all) sees a read-only summary, no form", async () => {
    mockLifeSpace("volunteer");
    renderPage();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.getByText(/doesn't include editing/i)).toBeInTheDocument();
    expect(screen.getByText("Ada's Wedding")).toBeInTheDocument();
    await screen.findByText("Security");
  });

  it("a finance_manager saving basic settings does not send visibility fields in the request", async () => {
    mockLifeSpace("finance_manager");
    api.updateLifeSpace.mockResolvedValue({ lifeSpace: baseSpace });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(api.updateLifeSpace).toHaveBeenCalled());
    const [, payload] = api.updateLifeSpace.mock.calls[0];
    expect(payload).not.toHaveProperty("visibility");
    expect(payload).not.toHaveProperty("showBudgetPublic");
    expect(payload).not.toHaveProperty("allowIndexing");
    expect(payload).not.toHaveProperty("passcode");
  });

  it("the owner's save does include visibility fields", async () => {
    mockLifeSpace("owner");
    api.updateLifeSpace.mockResolvedValue({ lifeSpace: baseSpace });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(api.updateLifeSpace).toHaveBeenCalled());
    const [, payload] = api.updateLifeSpace.mock.calls[0];
    expect(payload).toHaveProperty("visibility");
  });

  it("still shows Account and Security even with no life space at all", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null, refresh: vi.fn() });
    renderPage();
    expect(screen.getByText(/create a life space to manage its settings/i)).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(await screen.findByText("Security")).toBeInTheDocument();
  });
});
