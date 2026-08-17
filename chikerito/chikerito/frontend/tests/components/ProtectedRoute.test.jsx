import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/renderWithProviders.jsx";
import ProtectedRoute from "../../src/components/ProtectedRoute.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function renderProtected() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Login Page</div>} />
      <Route
        path="/protected"
        element={
          <ProtectedRoute>
            <div>Secret Content</div>
          </ProtectedRoute>
        }
      />
    </Routes>,
    { route: "/protected" }
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redirects to /login when there is no token at all", async () => {
    api.me.mockRejectedValue(new Error("no token"));
    renderProtected();

    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
    expect(screen.queryByText("Secret Content")).not.toBeInTheDocument();
  });

  it("renders the protected content once a valid token resolves a user", async () => {
    localStorage.setItem("chikerito_token", "valid-token");
    api.me.mockResolvedValue({ user: { id: "u1", firstName: "Ada" } });
    renderProtected();

    expect(await screen.findByText("Secret Content")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("redirects to /login and clears the token when it's invalid or expired", async () => {
    localStorage.setItem("chikerito_token", "stale-token");
    api.me.mockRejectedValue(new Error("Invalid or expired token"));
    renderProtected();

    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
    expect(localStorage.getItem("chikerito_token")).toBeNull();
  });

  it("shows a loading state before the auth check resolves", async () => {
    localStorage.setItem("chikerito_token", "valid-token");
    let resolveMe;
    api.me.mockReturnValue(new Promise((resolve) => { resolveMe = resolve; }));
    renderProtected();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    resolveMe({ user: { id: "u1" } });
    expect(await screen.findByText("Secret Content")).toBeInTheDocument();
  });
});
