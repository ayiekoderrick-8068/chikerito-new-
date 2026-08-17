import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const TYPE_ICON = {
  milestone_funded: "🏆",
  team_joined: "🤝",
  budget_warning: "⚠️",
  donation: "💛",
  expense_added: "🧾",
};

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function NotificationCenter({ lifeSpaceId }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef(null);

  async function refreshUnreadCount() {
    if (!lifeSpaceId) return;
    try {
      const { count } = await api.getUnreadNotificationCount(lifeSpaceId);
      setUnreadCount(count);
    } catch (err) {
      // Non-fatal — the badge just stays at its last known value.
    }
  }

  useEffect(() => {
    setNotifications([]);
    setUnreadCount(0);
    setOpen(false);
    refreshUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifeSpaceId]);

  async function loadNotifications() {
    if (!lifeSpaceId) return;
    setLoading(true);
    setError("");
    try {
      const { notifications } = await api.listNotifications(lifeSpaceId, { limit: 20 });
      setNotifications(notifications);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) loadNotifications();
  }

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleMarkRead(notification) {
    setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(c - 1, 0));
    try {
      await api.setNotificationRead(notification.id, true);
    } catch (err) {
      // Roll back on failure so the UI doesn't lie about server state.
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: false } : n)));
      setUnreadCount((c) => c + 1);
    }
  }

  async function handleDismiss(notification) {
    const wasUnread = !notification.read;
    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    if (wasUnread) setUnreadCount((c) => Math.max(c - 1, 0));
    try {
      await api.deleteNotification(notification.id);
    } catch (err) {
      await loadNotifications();
      await refreshUnreadCount();
    }
  }

  async function handleMarkAllRead() {
    const previousNotifications = notifications;
    const previousCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead(lifeSpaceId);
    } catch (err) {
      setNotifications(previousNotifications);
      setUnreadCount(previousCount);
      setError(err.message);
    }
  }

  if (!lifeSpaceId) return null;

  return (
    <div className="notification-center" ref={panelRef}>
      <button
        type="button"
        className="notification-bell"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-panel-head">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div className="notification-panel-state">Loading...</div>
          ) : error ? (
            <div className="notification-panel-state error-banner">{error}</div>
          ) : notifications.length === 0 ? (
            <div className="notification-panel-state">No notifications yet.</div>
          ) : (
            <ul className="notification-list">
              {notifications.map((n) => (
                <li key={n.id} className={`notification-row ${n.read ? "" : "unread"}`}>
                  <span className="notification-icon">{TYPE_ICON[n.type] || "🔔"}</span>
                  <button
                    type="button"
                    className="notification-message"
                    onClick={() => !n.read && handleMarkRead(n)}
                    disabled={n.read}
                  >
                    <span>{n.message}</span>
                    <span className="notification-time">{relativeTime(n.created_at)}</span>
                  </button>
                  <button
                    type="button"
                    className="notification-dismiss"
                    aria-label="Dismiss"
                    onClick={() => handleDismiss(n)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
