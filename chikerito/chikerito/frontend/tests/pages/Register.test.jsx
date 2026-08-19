import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/renderWithProviders.jsx";
import Register from "../../src/pages/Register.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

// Same label/input association gap as Login — query by role/type order instead.
function textInputs() {
  return screen.getAllByRole("textbox"); // [firstName, lastName, email]
}
function passwordInput() {
  return document.querySelector('input[type="password"]');
}

function renderRegister() {
  return renderWithProviders(
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<div>App Home</div>} />
    </Routes>,
    { route: "/register" }
  );
}

async function fillForm({ firstName = "Ada", lastName = "Lovelace", email = "ada@example.com", password = "chikerito123" } = {}) {
  const [first, last, mail] = textInputs();
  await userEvent.type(first, firstName);
  await userEvent.type(last, lastName);
  await userEvent.type(mail, email);
  await userEvent.type(passwordInput(), password);
}

describe("Register", () => {
  beforeEach(() => {
    api.me.mockRejectedValue(new Error("no token"));
  });

  it("starts with empty fields", () => {
    renderRegister();
    const [first, last, mail] = textInputs();
    expect(first).toHaveValue("");
    expect(last).toHaveValue("");
    expect(mail).toHaveValue("");
    expect(passwordInput()).toHaveValue("");
  });

  it("enforces a minimum password length in the markup", () => {
    renderRegister();
    expect(passwordInput()).toHaveAttribute("minLength", "6");
    expect(passwordInput()).toBeRequired();
  });

  it("registers and navigates to /app on success", async () => {
    api.register.mockResolvedValue({ token: "tok-789", user: { id: "u3", firstName: "Ada" } });
    renderRegister();

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(api.register).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      password: "chikerito123",
    });
    await waitFor(() => expect(screen.getByText("App Home")).toBeInTheDocument());
    expect(localStorage.getItem("chikerito_token")).toBe("tok-789");
  });

  it("shows the server error and does not navigate on a duplicate email", async () => {
    api.register.mockRejectedValue(new Error("An account with this email already exists"));
    renderRegister();

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(await screen.findByText("An account with this email already exists")).toBeInTheDocument();
    expect(screen.queryByText("App Home")).not.toBeInTheDocument();
  });
});
