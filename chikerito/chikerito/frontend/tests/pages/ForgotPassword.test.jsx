import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/renderWithProviders.jsx";
import ForgotPassword from "../../src/pages/ForgotPassword.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/forgot-password" element={<ForgotPassword />} />
    </Routes>,
    { route: "/forgot-password", withAuth: false }
  );
}

describe("ForgotPassword", () => {
  it("submits the email and shows the generic success message", async () => {
    api.forgotPassword.mockResolvedValue({ message: "If an account exists for that email, a password reset link has been sent." });
    renderPage();

    await userEvent.type(document.querySelector('input[type="email"]'), "ada@chikerito.test");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(api.forgotPassword).toHaveBeenCalledWith("ada@chikerito.test");
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it("shows the dev-mode reset link when the backend returns one", async () => {
    api.forgotPassword.mockResolvedValue({ message: "ok", resetUrl: "/reset-password?token=abc123" });
    renderPage();

    await userEvent.type(document.querySelector('input[type="email"]'), "ada@chikerito.test");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/dev mode/i)).toBeInTheDocument();
  });

  it("does not show a dev-mode link when the backend doesn't return one", async () => {
    api.forgotPassword.mockResolvedValue({ message: "ok" });
    renderPage();

    await userEvent.type(document.querySelector('input[type="email"]'), "ada@chikerito.test");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await screen.findByText(/if an account exists/i);
    expect(screen.queryByText(/dev mode/i)).not.toBeInTheDocument();
  });

  it("shows an error if the request itself fails", async () => {
    api.forgotPassword.mockRejectedValue(new Error("Network error"));
    renderPage();

    await userEvent.type(document.querySelector('input[type="email"]'), "ada@chikerito.test");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});
