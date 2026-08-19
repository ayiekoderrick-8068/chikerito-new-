import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  NOTIFICATION_TYPES,
  adjustUnreadCount,
  emptyInboxMessage,
  mergeNotificationPages,
  notificationIcon,
  relativeTime,
} from "../notificationInboxView";

const FILTERS = [{ value: "all", label: "All" }, { value: "unread", label: "Unread" }, { value: "read", label: "Read" }];

export { relativeTime };

export default function NotificationCenter({ lifeSpaceId }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [dismissed, setDismissed] = useState(null);
  const [resultTotal, setResultTotal] = useState(null);
  const panelRef = useRef(null);
  const requestSequence = useRef(0);

  async function refreshUnreadCount() {
    if (!lifeSpaceId) return;
    try {
      const { count } = await api.getUnreadNotificationCount(lifeSpaceId);
      setUnreadCount(count);
    } catch {
      // Badge refresh is intentionally non-fatal; opening the inbox still
      // exposes its own actionable error state.
    }
  }

  async function loadNotifications({ append = false, cursor = null } = {}) {
    if (!lifeSpaceId) return;
    const sequence = ++requestSequence.current;
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const result = await api.listNotifications(lifeSpaceId, {
        filter,
        type: type || undefined,
        q: appliedQuery || undefined,
        cursor: cursor || undefined,
        limit: 20,
      });
      if (sequence !== requestSequence.current) return;
      setNotifications((previous) => append ? mergeNotificationPages(previous, result.notifications) : result.notifications);
      setNextCursor(result.nextCursor || null);
      setResultTotal(Number.isFinite(result.total) ? result.total : null);
    } catch (err) {
      if (sequence === requestSequence.current) setError(err.message);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    setNotifications([]);
    setUnreadCount(0);
    setNextCursor(null);
    setFilter("all");
    setType("");
    setQuery("");
    setAppliedQuery("");
    setActionError("");
    setDismissed(null);
    setResultTotal(null);
    setOpen(false);
    refreshUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifeSpaceId]);

  useEffect(() => {
    if (open) loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, type, appliedQuery]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) loadNotifications();
  }

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function setRead(notification, read) {
    const previousCount = unreadCount;
    setActionError("");
    setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, read } : item));
    setUnreadCount((count) => adjustUnreadCount(count, notification.read, read));
    try {
      await api.setNotificationRead(notification.id, read);
      if ((filter === "unread" && read) || (filter === "read" && !read)) {
        setNotifications((items) => items.filter((item) => item.id !== notification.id));
      }
    } catch (err) {
      setNotifications((items) => items.map((item) => item.id === notification.id ? notification : item));
      setUnreadCount(previousCount);
      setActionError(err.message || "Notification could not be updated");
    }
  }

  async function handleDismiss(notification) {
    const previous = notifications;
    const previousCount = unreadCount;
    setActionError("");
    setDismissed(null);
    setNotifications((items) => items.filter((item) => item.id !== notification.id));
    if (!notification.read) setUnreadCount((count) => Math.max(count - 1, 0));
    try {
      await api.deleteNotification(notification.id);
      setDismissed(notification);
      setResultTotal((total) => total === null ? null : Math.max(0, total - 1));
    } catch (err) {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setActionError(err.message || "Notification could not be dismissed");
    }
  }

  async function undoDismiss() {
    if (!dismissed) return;
    const restoring = dismissed;
    setActionError("");
    setDismissed(null);
    try {
      await api.restoreNotification(restoring.id);
      await Promise.all([loadNotifications(), refreshUnreadCount()]);
    } catch (err) {
      setDismissed(restoring);
      setActionError(err.message || "Notification could not be restored");
    }
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    const previousCount = unreadCount;
    setActionError("");
    setNotifications((items) => filter === "unread" ? [] : items.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead(lifeSpaceId);
    } catch (err) {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setActionError(err.message || "Notifications could not be updated");
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  if (!lifeSpaceId) return null;

  return (
    <div className="notification-center" ref={panelRef}>
      <button type="button" className="notification-bell" aria-label="Notifications" aria-expanded={open} onClick={toggleOpen}>
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && <div className="notification-panel notification-inbox" role="dialog" aria-label="Notifications">
        <div className="notification-panel-head">
          <div><strong>Notifications</strong><small>Your personal inbox</small></div>
          {unreadCount > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={handleMarkAllRead}>Mark all read</button>}
        </div>

        <div className="notification-filters" aria-label="Notification filters">
          {FILTERS.map((option) => <button key={option.value} type="button" className={`notification-filter ${filter === option.value ? "active" : ""}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>)}
        </div>
        <form className="notification-search" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="notification-search">Search notifications</label>
          <input id="notification-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notifications" />
          <button className="btn btn-ghost btn-sm" type="submit">Search</button>
        </form>

        <div className="notification-discovery-row">
          <label htmlFor="notification-type">Type</label>
          <select id="notification-type" value={type} onChange={(event) => setType(event.target.value)}>
            {NOTIFICATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {resultTotal !== null && !loading && <span
            aria-live="polite"
            aria-label={`${resultTotal} notification ${resultTotal === 1 ? "result" : "results"}`}
          >{resultTotal} {resultTotal === 1 ? "result" : "results"}</span>}
        </div>

        {actionError && <div className="notification-action-error error-banner" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActionError("")}>Dismiss error</button>
        </div>}
        {dismissed && <div className="notification-undo" role="status">
          <span>Notification dismissed.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={undoDismiss}>Undo</button>
        </div>}

        {loading ? <div className="notification-panel-state" role="status">Loading...</div>
          : error ? <div className="notification-panel-state error-banner"><span>{error}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => loadNotifications()}>Try again</button></div>
          : notifications.length === 0 ? <div className="notification-panel-state">{emptyInboxMessage({ filter, query: appliedQuery, type })}</div>
          : <>
            <ul className="notification-list">
              {notifications.map((notification) => <li key={notification.id} className={`notification-row ${notification.read ? "" : "unread"}`}>
                <span className="notification-icon">{notificationIcon(notification.type)}</span>
                <button type="button" className="notification-message" onClick={() => !notification.read && setRead(notification, true)} disabled={notification.read}>
                  <span>{notification.message}</span>
                  <span className="notification-time">{relativeTime(notification.created_at)}</span>
                </button>
                <button type="button" className="notification-read-toggle" aria-label={notification.read ? "Mark unread" : "Mark read"} onClick={() => setRead(notification, !notification.read)}>{notification.read ? "○" : "●"}</button>
                <button type="button" className="notification-dismiss" aria-label="Dismiss" onClick={() => handleDismiss(notification)}>✕</button>
              </li>)}
            </ul>
            {nextCursor && <div className="notification-load-more"><button type="button" className="btn btn-ghost btn-sm" disabled={loadingMore} onClick={() => loadNotifications({ append: true, cursor: nextCursor })}>{loadingMore ? "Loading…" : "Load more"}</button></div>}
          </>}
      </div>}
    </div>
  );
}
