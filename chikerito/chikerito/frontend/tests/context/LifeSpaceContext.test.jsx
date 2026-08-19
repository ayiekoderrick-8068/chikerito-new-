import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../../src/context/AuthContext.jsx";
import { LifeSpaceProvider, useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function Probe() {
  const { lifeSpaces, current, currentId, selectLifeSpace, loading } = useLifeSpace();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="count">{lifeSpaces.length}</div>
      <div data-testid="current-id">{currentId || "none"}</div>
      <div data-testid="current-title">{current ? current.title : "none"}</div>
      {lifeSpaces.map((ls) => (
        <button key={ls.id} onClick={() => selectLifeSpace(ls.id)}>{`select ${ls.title}`}</button>
      ))}
    </div>
  );
}

function renderWithAuthedUser() {
  localStorage.setItem("chikerito_token", "existing-token");
  api.me.mockResolvedValue({ user: { id: "u1", email: "owner@chikerito.test" } });
  return render(
    <AuthProvider>
      <LifeSpaceProvider>
        <Probe />
      </LifeSpaceProvider>
    </AuthProvider>
  );
}

describe("LifeSpaceContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("fetches life spaces once the user is authenticated and auto-selects the first one", async () => {
    api.listLifeSpaces.mockResolvedValue({
      lifeSpaces: [
        { id: "ls1", title: "Wedding" },
        { id: "ls2", title: "Graduation" },
      ],
    });
    renderWithAuthedUser();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(screen.getByTestId("current-id")).toHaveTextContent("ls1");
    expect(screen.getByTestId("current-title")).toHaveTextContent("Wedding");
    expect(localStorage.getItem("chikerito_current_ls")).toBe("ls1");
  });

  it("keeps a previously-selected currentId from localStorage instead of overriding it", async () => {
    localStorage.setItem("chikerito_current_ls", "ls2");
    api.listLifeSpaces.mockResolvedValue({
      lifeSpaces: [
        { id: "ls1", title: "Wedding" },
        { id: "ls2", title: "Graduation" },
      ],
    });
    renderWithAuthedUser();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));
    expect(screen.getByTestId("current-id")).toHaveTextContent("ls2");
    expect(screen.getByTestId("current-title")).toHaveTextContent("Graduation");
  });

  it("selectLifeSpace() switches the current life space and persists the choice", async () => {
    api.listLifeSpaces.mockResolvedValue({
      lifeSpaces: [
        { id: "ls1", title: "Wedding" },
        { id: "ls2", title: "Graduation" },
      ],
    });
    renderWithAuthedUser();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    await userEvent.click(screen.getByText("select Graduation"));

    expect(screen.getByTestId("current-id")).toHaveTextContent("ls2");
    expect(localStorage.getItem("chikerito_current_ls")).toBe("ls2");
  });

  it("stays empty with no life spaces and no currentId when the account has none yet", async () => {
    api.listLifeSpaces.mockResolvedValue({ lifeSpaces: [] });
    renderWithAuthedUser();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("current-id")).toHaveTextContent("none");
  });

  // Documented gap, not fixed here (frontend test tooling should surface real
  // bugs, not paper over them): refresh() returns early via `if (!user) return;`
  // *before* the try/finally that calls setLoading(false), so with no
  // authenticated user `loading` is stuck at its initial `true` forever. Any
  // page gating on LifeSpaceContext's `loading` (none currently do) would spin
  // indefinitely for a logged-out user.
  it("known gap: loading never resolves to false when there is no authenticated user", async () => {
    api.me.mockRejectedValue(new Error("no token"));
    render(
      <AuthProvider>
        <LifeSpaceProvider>
          <Probe />
        </LifeSpaceProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
  });
});
