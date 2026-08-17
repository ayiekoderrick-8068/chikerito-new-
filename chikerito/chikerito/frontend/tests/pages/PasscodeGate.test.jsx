import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PasscodeGate from "../../src/components/PasscodeGate.jsx";

describe("PasscodeGate", () => {
  it("disables Continue until a non-blank passcode is entered", async () => {
    render(<PasscodeGate onSubmit={vi.fn()} />);
    const button = screen.getByRole("button", { name: /continue/i });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/enter passcode/i), "1234");
    expect(button).toBeEnabled();
  });

  it("submits the trimmed passcode", async () => {
    const onSubmit = vi.fn();
    render(<PasscodeGate onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/enter passcode/i), "  secret42  ");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith("secret42");
  });

  it("never submits a whitespace-only passcode", async () => {
    const onSubmit = vi.fn();
    render(<PasscodeGate onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(/enter passcode/i);

    await userEvent.type(input, "   ");
    await userEvent.type(input, "{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("displays a passed-in error message", () => {
    render(<PasscodeGate onSubmit={vi.fn()} error="Incorrect passcode." />);
    expect(screen.getByText("Incorrect passcode.")).toBeInTheDocument();
  });
});
