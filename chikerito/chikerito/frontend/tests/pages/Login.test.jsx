import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/renderWithProviders.jsx";
import Login from "../../src/pages/Login.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

// Login's <label> elements aren't associated with their <input>s (no htmlFor/id,
// not wrapping) — a real accessibility gap, left as-is per instructions. Query
// by input type instead of getByLabelText, which would otherwise find nothing.
function emailInput() {
  return document.querySelector('input[type="email"]');
}
function passwordInput() {
  return document.querySelector('input[type="password"]');
}

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<div>App Home</div>} />
    </Routes>,
    { route: "/login" }
  );
}

describe("Login", () => {
  beforeEach(() => {
    api.me.mockRejectedValue(new Error("no token"));
  });

  it("pre-fills the demo credentials", () => {
    renderLogin();
    expect(emailInput()).toHaveValue("demo@chikerito.com");
    expect(passwordInput()).toHaveValue("chikerito123");
  });

  it("logs in and navigates to /app on success", async () => {
    api.login.mockResolvedValue({ token: "tok-123", user: { id: "u1", firstName: "Demo" } });
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(api.login).toHaveBeenCalledWith({ email: "demo@chikerito.com", password: "chikerito123" });
    await waitFor(() => expect(screen.getByText("App Home")).toBeInTheDocument());
    expect(localStorage.getItem("chikerito_token")).toBe("tok-123");
  });

  it("shows the server error and does not navigate on failed login", async () => {
    api.login.mockRejectedValue(new Error("Invalid email or password"));
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(screen.queryByText("App Home")).not.toBeInTheDocument();
  });

  it("submits whatever the user types instead of the demo defaults", async () => {
    api.login.mockResolvedValue({ token: "tok-456", user: { id: "u2" } });
    renderLogin();

    await userEvent.clear(emailInput());
    await userEvent.type(emailInput(), "someone@example.com");
    await userEvent.clear(passwordInput());
    await userEvent.type(passwordInput(), "swordfish");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(api.login).toHaveBeenCalledWith({ email: "someone@example.com", password: "swordfish" });
  });
});
