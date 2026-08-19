import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/renderWithProviders.jsx";
import ResetPassword from "../../src/pages/ResetPassword.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function renderPage(route = "/reset-password?token=abc123") {
  return renderWithProviders(
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/login" element={<div>Login Page</div>} />
    </Routes>,
    { route, withAuth: false }
  );
}

function passwordInputs() {
  return document.querySelectorAll('input[type="password"]');
}

describe("ResetPassword", () => {
  it("shows an error and no form when the URL has no token", () => {
    renderPage("/reset-password");
    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
    expect(passwordInputs()).toHaveLength(0);
  });

  it("submits the token and new password", async () => {
    api.resetPassword.mockResolvedValue({ message: "ok" });
    renderPage();

    const [password, confirm] = passwordInputs();
    await userEvent.type(password, "newpassword1");
    await userEvent.type(confirm, "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(api.resetPassword).toHaveBeenCalledWith("abc123", "newpassword1");
    expect(await screen.findByText(/has been reset/i)).toBeInTheDocument();
  });

  it("redirects to login shortly after success", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.resetPassword.mockResolvedValue({ message: "ok" });
    renderPage();

    const [password, confirm] = passwordInputs();
    await userEvent.type(password, "newpassword1");
    await userEvent.type(confirm, "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: /reset password/i }));
    await screen.findByText(/has been reset/i);

    vi.advanceTimersByTime(2100);
    await waitFor(() => expect(screen.getByText("Login Page")).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("rejects mismatched passwords client-side without calling the API", async () => {
    renderPage();
    const [password, confirm] = passwordInputs();
    await userEvent.type(password, "newpassword1");
    await userEvent.type(confirm, "different1");
    await userEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("shows a clear message and a way back for an expired/invalid token", async () => {
    api.resetPassword.mockRejectedValue(new Error("This reset link is invalid or has expired"));
    renderPage();

    const [password, confirm] = passwordInputs();
    await userEvent.type(password, "newpassword1");
    await userEvent.type(confirm, "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /forgot password/i })).toBeInTheDocument();
  });
});
