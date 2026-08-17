import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SecuritySettings from "../../src/components/SecuritySettings.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

const sessions = [
  { id: "s1", userAgent: "Mozilla/5.0 Chrome/1.0", createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: new Date(Date.now() - 60000).toISOString(), current: true },
  { id: "s2", userAgent: "Mozilla/5.0 Firefox/1.0", createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: new Date(Date.now() - 3 * 3600000).toISOString(), current: false },
];

describe("SecuritySettings", () => {
  it("shows a loading state, then the list with the current device tagged", async () => {
    api.listSessions.mockResolvedValue({ sessions });
    render(<SecuritySettings />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await screen.findByText("This device");
    expect(screen.getByText(/chrome/i)).toBeInTheDocument();
    expect(screen.getByText(/firefox/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no sessions", async () => {
    api.listSessions.mockResolvedValue({ sessions: [] });
    render(<SecuritySettings />);
    expect(await screen.findByText(/no active sessions/i)).toBeInTheDocument();
  });

  it("shows an error banner if loading fails", async () => {
    api.listSessions.mockRejectedValue(new Error("Network error"));
    render(<SecuritySettings />);
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("only shows a Sign out button on non-current sessions", async () => {
    api.listSessions.mockResolvedValue({ sessions });
    render(<SecuritySettings />);
    await screen.findByText("This device");

    expect(screen.getAllByRole("button", { name: /^sign out$/i })).toHaveLength(1);
  });

  it("revokes a single session and reloads the list", async () => {
    api.listSessions
      .mockResolvedValueOnce({ sessions })
      .mockResolvedValueOnce({ sessions: [sessions[0]] });
    api.revokeSession.mockResolvedValue({});
    render(<SecuritySettings />);
    await screen.findByText("This device");

    await userEvent.click(screen.getByRole("button", { name: /^sign out$/i }));

    expect(api.revokeSession).toHaveBeenCalledWith("s2");
    await waitFor(() => expect(screen.queryByText(/firefox/i)).not.toBeInTheDocument());
  });

  it("shows Sign out other sessions only when there is more than one session", async () => {
    api.listSessions.mockResolvedValue({ sessions: [sessions[0]] });
    render(<SecuritySettings />);
    await screen.findByText("This device");
    expect(screen.queryByRole("button", { name: /sign out other sessions/i })).not.toBeInTheDocument();
  });

  it("revoking other sessions asks for confirmation and calls the endpoint", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.listSessions
      .mockResolvedValueOnce({ sessions })
      .mockResolvedValueOnce({ sessions: [sessions[0]] });
    api.revokeOtherSessions.mockResolvedValue({ revoked: 1 });
    render(<SecuritySettings />);
    await screen.findByText("This device");

    await userEvent.click(screen.getByRole("button", { name: /sign out other sessions/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.revokeOtherSessions).toHaveBeenCalled());
  });

  it("does not revoke other sessions if the user cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    api.listSessions.mockResolvedValue({ sessions });
    render(<SecuritySettings />);
    await screen.findByText("This device");

    await userEvent.click(screen.getByRole("button", { name: /sign out other sessions/i }));

    expect(api.revokeOtherSessions).not.toHaveBeenCalled();
  });
});
