import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationCenter, { relativeTime } from "../../src/components/NotificationCenter.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

const unread = {
  id: "notice-unread",
  type: "budget_warning",
  message: "Catering may exceed its budget",
  read: false,
  created_at: "2026-08-18T09:55:00.000Z",
};
const read = {
  id: "notice-read",
  type: "donation",
  message: "Aunt Mary contributed",
  read: true,
  created_at: "2026-08-18T08:00:00.000Z",
};

function page(notifications = [unread, read], nextCursor = null) {
  return { notifications, hasMore: !!nextCursor, nextCursor };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function openInbox(props = {}) {
  render(<NotificationCenter lifeSpaceId="space-1" {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
}

describe("UserNotificationInbox presentation and discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getUnreadNotificationCount.mockResolvedValue({ count: 1 });
    api.listNotifications.mockResolvedValue(page());
    api.setNotificationRead.mockResolvedValue({ notification: { ...unread, read: true } });
    api.deleteNotification.mockResolvedValue({});
    api.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
  });

  it("identifies the panel as a personal inbox", async () => {
    await openInbox();
    expect(await screen.findByText("Your personal inbox")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  });

  it("loads the all filter with a bounded initial page", async () => {
    await openInbox();
    await screen.findByText(unread.message);
    expect(api.listNotifications).toHaveBeenCalledWith("space-1", {
      filter: "all",
      type: undefined,
      q: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("exposes filter selection with aria-pressed state", async () => {
    await openInbox();
    const all = screen.getByRole("button", { name: "All" });
    const unreadButton = screen.getByRole("button", { name: "Unread" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(unreadButton).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(unreadButton);
    expect(unreadButton).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.listNotifications).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ filter: "unread" })));
  });

  it("shows the unread-specific empty state", async () => {
    api.listNotifications.mockResolvedValue(page([]));
    await openInbox();
    await userEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it("applies a trimmed search only after form submission", async () => {
    await openInbox();
    await screen.findByText(unread.message);
    const search = screen.getByRole("textbox", { name: "Search notifications" });
    await userEvent.type(search, "  catering  ");
    expect(api.listNotifications).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(api.listNotifications).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ q: "catering" })));
  });

  it("shows a search-specific empty state", async () => {
    api.listNotifications.mockResolvedValue(page([]));
    await openInbox();
    await userEvent.type(screen.getByRole("textbox", { name: "Search notifications" }), "missing vendor");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No notifications match your search.")).toBeInTheDocument();
  });

  it("filters by notification type and announces the result total", async () => {
    api.listNotifications
      .mockResolvedValueOnce({ ...page(), total: 2 })
      .mockResolvedValueOnce({ ...page([unread]), total: 1 });
    await openInbox();
    expect(await screen.findByText("2 results")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type" }), "budget_warning");
    await waitFor(() => expect(api.listNotifications).toHaveBeenLastCalledWith(
      "space-1",
      expect.objectContaining({ type: "budget_warning" })
    ));
    expect(await screen.findByText("1 result")).toBeInTheDocument();
  });

  it("retries a failed initial list request", async () => {
    api.listNotifications.mockRejectedValueOnce(new Error("Inbox unavailable")).mockResolvedValueOnce(page([unread]));
    await openInbox();
    expect(await screen.findByText("Inbox unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(unread.message)).toBeInTheDocument();
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
  });

  it("keeps badge failures non-fatal", async () => {
    api.getUnreadNotificationCount.mockRejectedValue(new Error("Count unavailable"));
    await openInbox();
    expect(await screen.findByText(unread.message)).toBeInTheDocument();
    expect(screen.queryByText("Count unavailable")).not.toBeInTheDocument();
  });

  it("appends the next cursor page in server order", async () => {
    const later = { ...read, id: "notice-page-2", message: "Second page item" };
    api.listNotifications.mockResolvedValueOnce(page([unread], "cursor-two")).mockResolvedValueOnce(page([later]));
    await openInbox();
    await screen.findByText(unread.message);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText(later.message)).toBeInTheDocument();
    expect(screen.getByText(unread.message)).toBeInTheDocument();
    expect(api.listNotifications).toHaveBeenLastCalledWith("space-1", expect.objectContaining({ cursor: "cursor-two" }));
  });

  it("disables pagination while the next page is pending", async () => {
    const next = deferred();
    api.listNotifications.mockResolvedValueOnce(page([unread], "next")).mockReturnValueOnce(next.promise);
    await openInbox();
    const loadMore = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(loadMore);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    next.resolve(page([]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading…" })).not.toBeInTheDocument());
  });

  it("ignores a stale response after the filter changes", async () => {
    const allRequest = deferred();
    const filtered = { ...unread, id: "filtered", message: "Only unread result" };
    api.listNotifications.mockReturnValueOnce(allRequest.promise).mockResolvedValueOnce(page([filtered]));
    await openInbox();
    await userEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(await screen.findByText(filtered.message)).toBeInTheDocument();

    allRequest.resolve(page([read]));
    await waitFor(() => expect(screen.queryByText(read.message)).not.toBeInTheDocument());
    expect(screen.getByText(filtered.message)).toBeInTheDocument();
  });
});

describe("UserNotificationInbox personal actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getUnreadNotificationCount.mockResolvedValue({ count: 1 });
    api.listNotifications.mockResolvedValue(page());
    api.setNotificationRead.mockResolvedValue({});
    api.deleteNotification.mockResolvedValue({});
    api.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
  });

  it("offers an explicit mark-read control for unread rows", async () => {
    await openInbox();
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Mark read" }));
    expect(api.setNotificationRead).toHaveBeenCalledWith(unread.id, true);
    await waitFor(() => expect(within(row).getByRole("button", { name: "Mark unread" })).toBeInTheDocument());
  });

  it("allows a read item to be marked unread and increments the badge", async () => {
    await openInbox();
    const row = (await screen.findByText(read.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Mark unread" }));
    expect(api.setNotificationRead).toHaveBeenCalledWith(read.id, false);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("removes a newly-read row from the unread filter", async () => {
    api.listNotifications.mockResolvedValue(page([unread]));
    await openInbox();
    await userEvent.click(screen.getByRole("button", { name: "Unread" }));
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(screen.queryByText(unread.message)).not.toBeInTheDocument());
  });

  it("removes a newly-unread row from the read filter", async () => {
    api.listNotifications.mockResolvedValue(page([read]));
    await openInbox();
    await userEvent.click(screen.getByRole("button", { name: "Read" }));
    const row = (await screen.findByText(read.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Mark unread" }));
    await waitFor(() => expect(screen.queryByText(read.message)).not.toBeInTheDocument());
  });

  it("restores a dismissed row and unread count when dismissal fails", async () => {
    api.deleteNotification.mockRejectedValue(new Error("Dismiss failed"));
    await openInbox();
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByText("Dismiss failed")).toBeInTheDocument();
    expect(screen.getByText(unread.message)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("undoes a successful personal dismissal and refreshes the inbox", async () => {
    api.restoreNotification.mockResolvedValue({ notification: unread });
    await openInbox();
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Notification dismissed.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(api.restoreNotification).toHaveBeenCalledWith(unread.id);
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(2));
    expect(api.getUnreadNotificationCount).toHaveBeenCalledTimes(2);
  });

  it("keeps undo available when a restore request fails", async () => {
    api.restoreNotification.mockRejectedValue(new Error("Restore failed"));
    await openInbox();
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Restore failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("restores all optimistic states when mark-all fails", async () => {
    api.markAllNotificationsRead.mockRejectedValue(new Error("Bulk update failed"));
    await openInbox();
    await screen.findByText(unread.message);
    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(await screen.findByText("Bulk update failed")).toBeInTheDocument();
    expect(screen.getByText(unread.message).closest("li")).toHaveClass("unread");
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("lets the user dismiss an action error without refetching", async () => {
    api.setNotificationRead.mockRejectedValue(new Error("Update failed"));
    await openInbox();
    const row = (await screen.findByText(unread.message)).closest("li");
    await userEvent.click(within(row).getByRole("button", { name: "Mark read" }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Update failed")).not.toBeInTheDocument();
    expect(api.listNotifications).toHaveBeenCalledTimes(1);
  });

  it("resets and closes personal inbox state when life space changes", async () => {
    const { rerender } = render(<NotificationCenter lifeSpaceId="space-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText(unread.message);

    rerender(<NotificationCenter lifeSpaceId="space-2" />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument());
    expect(api.getUnreadNotificationCount).toHaveBeenCalledWith("space-2");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-18T10:00:00.000Z").getTime();

  it.each([
    ["2026-08-18T10:00:00.000Z", "just now"],
    ["2026-08-18T09:55:00.000Z", "5m ago"],
    ["2026-08-18T08:00:00.000Z", "2h ago"],
    ["2026-08-16T10:00:00.000Z", "2d ago"],
    ["2026-08-18T10:05:00.000Z", "just now"],
  ])("formats %s deterministically as %s", (timestamp, expected) => {
    expect(relativeTime(timestamp, now)).toBe(expected);
  });
});
