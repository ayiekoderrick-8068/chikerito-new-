import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  adjustUnreadCount,
  emptyInboxMessage,
  mergeNotificationPages,
  notificationIcon,
  relativeTime,
} from "../src/notificationInboxView";

describe("notification inbox view helpers", () => {
  it("has stable user-facing type choices beginning with all types", () => {
    expect(NOTIFICATION_TYPES[0]).toEqual({ value: "", label: "All types" });
    expect(NOTIFICATION_TYPES.map((type) => type.value)).toContain("budget_warning");
  });

  it.each([
    ["budget_warning", "⚠️"],
    ["donation", "💛"],
    ["expense_added", "🧾"],
    ["milestone_funded", "🏆"],
    ["team_joined", "🤝"],
    ["future_type", "🔔"],
  ])("maps %s to a safe icon", (type, icon) => {
    expect(notificationIcon(type)).toBe(icon);
  });

  it("merges cursor pages without duplicating an overlapping id", () => {
    const first = [{ id: "a" }, { id: "b" }];
    const second = [{ id: "b" }, { id: "c" }];
    expect(mergeNotificationPages(first, second).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate either cursor page while merging", () => {
    const first = [{ id: "a" }];
    const second = [{ id: "b" }];
    mergeNotificationPages(first, second);
    expect(first).toEqual([{ id: "a" }]);
    expect(second).toEqual([{ id: "b" }]);
  });

  it.each([
    [3, false, true, 2],
    [3, true, false, 4],
    [3, true, true, 3],
    [0, false, true, 0],
  ])("adjusts unread count %s from read=%s to read=%s", (count, wasRead, nextRead, expected) => {
    expect(adjustUnreadCount(count, wasRead, nextRead)).toBe(expected);
  });

  it.each([
    [{ filter: "unread", query: "", type: "" }, "You're all caught up."],
    [{ filter: "all", query: "venue", type: "" }, "No notifications match your search."],
    [{ filter: "all", query: "", type: "donation" }, "No notifications of this type."],
    [{ filter: "read", query: "", type: "" }, "No read notifications yet."],
    [{ filter: "all", query: "", type: "" }, "No notifications yet."],
  ])("selects a contextual empty message", (options, expected) => {
    expect(emptyInboxMessage(options)).toBe(expected);
  });

  it("labels invalid timestamps safely", () => {
    expect(relativeTime("not-a-date", Date.now())).toBe("recently");
  });
});
