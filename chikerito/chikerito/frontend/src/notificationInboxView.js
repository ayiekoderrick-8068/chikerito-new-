export const NOTIFICATION_TYPES = [
  { value: "", label: "All types" },
  { value: "budget_warning", label: "Budget warnings" },
  { value: "donation", label: "Contributions" },
  { value: "expense_added", label: "Expenses" },
  { value: "milestone_funded", label: "Milestones" },
  { value: "team_joined", label: "Team updates" },
];

const TYPE_ICONS = {
  milestone_funded: "🏆",
  team_joined: "🤝",
  budget_warning: "⚠️",
  donation: "💛",
  expense_added: "🧾",
};

export function notificationIcon(type) {
  return TYPE_ICONS[type] || "🔔";
}

export function relativeTime(iso, now = Date.now()) {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "recently";
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Cursor pages should not overlap, but merging defensively by id prevents a
// rapidly changing inbox from ever rendering duplicate React rows.
export function mergeNotificationPages(existing, incoming) {
  const seen = new Set(existing.map((notification) => notification.id));
  return [
    ...existing,
    ...incoming.filter((notification) => {
      if (seen.has(notification.id)) return false;
      seen.add(notification.id);
      return true;
    }),
  ];
}

export function adjustUnreadCount(count, wasRead, nextRead) {
  if (wasRead === nextRead) return count;
  return Math.max(0, count + (nextRead ? -1 : 1));
}

export function emptyInboxMessage({ filter, query, type }) {
  if (filter === "unread" && !query && !type) return "You're all caught up.";
  if (query) return "No notifications match your search.";
  if (type) return "No notifications of this type.";
  if (filter === "read") return "No read notifications yet.";
  return "No notifications yet.";
}
