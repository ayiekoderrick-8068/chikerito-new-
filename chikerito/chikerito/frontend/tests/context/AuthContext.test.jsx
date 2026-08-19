import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "../../src/context/AuthContext.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function Probe() {
  const { user, loading, login, register, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.email || user.id : "none"}</div>
      <button onClick={() => login("a@b.c", "pw")}>login</button>
      <button onClick={() => register({ firstName: "A", lastName: "B", email: "a@b.c", password: "pw" })}>register</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with no user and finishes loading when there is no token", async () => {
    api.me.mockRejectedValue(new Error("no token"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("loads the user from a stored token via api.me()", async () => {
    localStorage.setItem("chikerito_token", "existing-token");
    api.me.mockResolvedValue({ user: { id: "u1", email: "stored@chikerito.test" } });
    renderProbe();
    expect(await screen.findByTestId("user")).toHaveTextContent("stored@chikerito.test");
  });

  it("clears a stale token when api.me() rejects", async () => {
    localStorage.setItem("chikerito_token", "stale-token");
    api.me.mockRejectedValue(new Error("Invalid or expired token"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(localStorage.getItem("chikerito_token")).toBeNull();
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("login() stores the token and sets the user", async () => {
    api.me.mockRejectedValue(new Error("no token"));
    api.login.mockResolvedValue({ token: "new-token", user: { id: "u2", email: "a@b.c" } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("login"));

    expect(await screen.findByTestId("user")).toHaveTextContent("a@b.c");
    expect(localStorage.getItem("chikerito_token")).toBe("new-token");
  });

  it("register() stores the token and sets the user", async () => {
    api.me.mockRejectedValue(new Error("no token"));
    api.register.mockResolvedValue({ token: "reg-token", user: { id: "u3", email: "a@b.c" } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await userEvent.click(screen.getByText("register"));

    expect(await screen.findByTestId("user")).toHaveTextContent("a@b.c");
    expect(localStorage.getItem("chikerito_token")).toBe("reg-token");
  });

  it("logout() clears the token and the user", async () => {
    localStorage.setItem("chikerito_token", "existing-token");
    api.me.mockResolvedValue({ user: { id: "u1", email: "stored@chikerito.test" } });
    renderProbe();
    await screen.findByTestId("user");

    await userEvent.click(screen.getByText("logout"));

    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(localStorage.getItem("chikerito_token")).toBeNull();
  });

  it("clears the user when a chikerito:unauthorized event fires from anywhere in the app", async () => {
    localStorage.setItem("chikerito_token", "existing-token");
    api.me.mockResolvedValue({ user: { id: "u1", email: "stored@chikerito.test" } });
    renderProbe();
    await screen.findByTestId("user");

    act(() => {
      window.dispatchEvent(new Event("chikerito:unauthorized"));
    });

    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });
});
