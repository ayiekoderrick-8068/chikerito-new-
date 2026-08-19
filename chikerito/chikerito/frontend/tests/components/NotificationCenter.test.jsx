import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationCenter from "../../src/components/NotificationCenter.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

const notifications = [
  { id: "n1", type: "donation", message: "Aunt Mary donated $100", read: false, created_at: new Date(Date.now() - 5 * 60000).toISOString() },
  { id: "n2", type: "expense_added", message: "Expense recorded: Florist", read: true, created_at: new Date(Date.now() - 2 * 3600000).toISOString() },
];

describe("NotificationCenter", () => {
  beforeEach(() => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 1 });
    api.listNotifications.mockResolvedValue({ notifications, hasMore: false });
  });

  it("renders nothing when there is no current life space", () => {
    const { container } = render(<NotificationCenter lifeSpaceId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the unread count badge on mount", async () => {
    render(<NotificationCenter lifeSpaceId="ls1" />);
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("hides the badge when there are no unread notifications", async () => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalled());
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("caps a large unread count display at 99+", async () => {
    api.getUnreadNotificationCount.mockResolvedValue({ count: 150 });
    render(<NotificationCenter lifeSpaceId="ls1" />);
    expect(await screen.findByText("99+")).toBeInTheDocument();
  });

  it("opens the panel and loads notifications on click", async () => {
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("Aunt Mary donated $100")).toBeInTheDocument();
    expect(screen.getByText("Expense recorded: Florist")).toBeInTheDocument();
  });

  it("shows a loading state while the list is being fetched", async () => {
    let resolveList;
    api.listNotifications.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    resolveList({ notifications: [], hasMore: false });
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  });

  it("shows an error state when the list fails to load", async () => {
    api.listNotifications.mockRejectedValue(new Error("Network error"));
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("shows an empty state when there are no notifications", async () => {
    api.listNotifications.mockResolvedValue({ notifications: [], hasMore: false });
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it("visually distinguishes unread from read notifications", async () => {
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Aunt Mary donated $100");

    const unreadRow = screen.getByText("Aunt Mary donated $100").closest("li");
    const readRow = screen.getByText("Expense recorded: Florist").closest("li");
    expect(unreadRow.className).toContain("unread");
    expect(readRow.className).not.toContain("unread");
  });

  it("marks a notification read on click and decrements the badge", async () => {
    api.setNotificationRead.mockResolvedValue({ notification: { ...notifications[0], read: true } });
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await screen.findByText("1"); // initial badge
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Aunt Mary donated $100");

    await userEvent.click(screen.getByText("Aunt Mary donated $100"));

    expect(api.setNotificationRead).toHaveBeenCalledWith("n1", true);
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
  });

  it("rolls back the optimistic read-state update if the request fails", async () => {
    api.setNotificationRead.mockRejectedValue(new Error("fail"));
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Aunt Mary donated $100");

    await userEvent.click(screen.getByText("Aunt Mary donated $100"));

    await waitFor(() => {
      const row = screen.getByText("Aunt Mary donated $100").closest("li");
      expect(row.className).toContain("unread");
    });
  });

  it("does not attempt to mark an already-read notification", async () => {
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Expense recorded: Florist");

    await userEvent.click(screen.getByText("Expense recorded: Florist"));

    expect(api.setNotificationRead).not.toHaveBeenCalled();
  });

  it("marks all as read and clears the badge", async () => {
    api.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await screen.findByText("1");
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Aunt Mary donated $100");

    await userEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    expect(api.markAllNotificationsRead).toHaveBeenCalledWith("ls1");
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
  });

  it("dismisses a notification and removes it from the list", async () => {
    api.deleteNotification.mockResolvedValue({});
    render(<NotificationCenter lifeSpaceId="ls1" />);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    const row = (await screen.findByText("Aunt Mary donated $100")).closest("li");

    await userEvent.click(within(row).getByRole("button", { name: /dismiss/i }));

    expect(api.deleteNotification).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByText("Aunt Mary donated $100")).not.toBeInTheDocument());
  });

  it("closes the panel when clicking outside it", async () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <NotificationCenter lifeSpaceId="ls1" />
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await screen.findByText("Aunt Mary donated $100");

    await userEvent.click(screen.getByTestId("outside"));

    await waitFor(() => expect(screen.queryByText("Aunt Mary donated $100")).not.toBeInTheDocument());
  });

  it("refetches the unread count when the life space changes", async () => {
    const { rerender } = render(<NotificationCenter lifeSpaceId="ls1" />);
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalledWith("ls1"));

    rerender(<NotificationCenter lifeSpaceId="ls2" />);
    await waitFor(() => expect(api.getUnreadNotificationCount).toHaveBeenCalledWith("ls2"));
  });
});
