const BASE = "/api";

function getToken() {
  return localStorage.getItem("chikerito_token");
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && auth) {
      // Session expired or token invalid — clear it and let AuthContext kick the user back to login,
      // instead of every authenticated action in the app failing silently from here on.
      localStorage.removeItem("chikerito_token");
      window.dispatchEvent(new Event("chikerito:unauthorized"));
    }
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function withPasscode(path, passcode) {
  return passcode ? `${path}?passcode=${encodeURIComponent(passcode)}` : path;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  me: () => request("/auth/me"),
  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),
  resetPassword: (token, password) => request("/auth/reset-password", { method: "POST", body: { token, password }, auth: false }),

  listSessions: () => request("/auth/sessions"),
  revokeSession: (id) => request(`/auth/sessions/${id}`, { method: "DELETE" }),
  revokeOtherSessions: () => request("/auth/sessions/revoke-others", { method: "POST" }),

  listLifeSpaces: () => request("/lifespaces"),
  createLifeSpace: (payload) => request("/lifespaces", { method: "POST", body: payload }),
  getLifeSpace: (id) => request(`/lifespaces/${id}`),
  updateLifeSpace: (id, payload) => request(`/lifespaces/${id}`, { method: "PATCH", body: payload }),
  getDashboard: (id) => request(`/lifespaces/${id}/dashboard`),
  getAnalytics: (id, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.comparison && filters.comparison !== "none") params.set("comparison", filters.comparison);
    const query = params.toString();
    return request(`/lifespaces/${id}/analytics${query ? `?${query}` : ""}`);
  },
  getPublicReport: (slug, passcode) => request(withPasscode(`/public/lifespaces/${slug}/report`, passcode), { auth: false }),

  listCategories: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/categories`),
  createCategory: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/categories`, { method: "POST", body: payload }),
  updateCategory: (id, payload) => request(`/categories/${id}`, { method: "PATCH", body: payload }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: "DELETE" }),

  listExpenses: (lifeSpaceId, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.before) params.set("before", filters.before);
    if (filters.limit) params.set("limit", filters.limit);
    const qs = params.toString();
    return request(`/lifespaces/${lifeSpaceId}/expenses${qs ? `?${qs}` : ""}`);
  },
  createExpense: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/expenses`, { method: "POST", body: payload }),
  updateExpense: (id, payload) => request(`/expenses/${id}`, { method: "PATCH", body: payload }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),

  listRecurringExpenses: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/recurring-expenses`),
  createRecurringExpense: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/recurring-expenses`, { method: "POST", body: payload }),
  updateRecurringExpense: (id, payload) => request(`/recurring-expenses/${id}`, { method: "PATCH", body: payload }),
  pauseRecurringExpense: (id) => request(`/recurring-expenses/${id}/pause`, { method: "POST" }),
  resumeRecurringExpense: (id) => request(`/recurring-expenses/${id}/resume`, { method: "POST" }),
  deleteRecurringExpense: (id) => request(`/recurring-expenses/${id}`, { method: "DELETE" }),
  listRecurringOccurrences: (id, { from, to, limit } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (limit) params.set("limit", limit);
    const query = params.toString();
    return request(`/recurring-expenses/${id}/occurrences${query ? `?${query}` : ""}`);
  },
  listRecurringExceptions: (id) => request(`/recurring-expenses/${id}/exceptions`),
  createRecurringException: (id, payload) => request(`/recurring-expenses/${id}/exceptions`, { method: "POST", body: payload }),
  updateRecurringException: (id, payload) => request(`/recurring-expense-exceptions/${id}`, { method: "PATCH", body: payload }),
  removeRecurringException: (id) => request(`/recurring-expense-exceptions/${id}`, { method: "DELETE" }),
  restoreRecurringException: (id) => request(`/recurring-expense-exceptions/${id}/restore`, { method: "POST" }),

  listBudgetScenarios: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/budget-scenarios`),
  getBudgetScenario: (id) => request(`/budget-scenarios/${id}`),
  previewBudgetScenario: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/budget-scenarios/preview`, { method: "POST", body: payload }),
  createBudgetScenario: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/budget-scenarios`, { method: "POST", body: payload }),
  updateBudgetScenario: (id, payload) => request(`/budget-scenarios/${id}`, { method: "PATCH", body: payload }),
  deleteBudgetScenario: (id) => request(`/budget-scenarios/${id}`, { method: "DELETE" }),

  listContributions: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/contributions`),
  createContribution: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/contributions`, { method: "POST", body: payload }),
  updateContribution: (id, payload) => request(`/contributions/${id}`, { method: "PATCH", body: payload }),
  publicContribute: (slug, payload, passcode) =>
    request(withPasscode(`/public/lifespaces/${slug}/contribute`, passcode), { method: "POST", body: payload, auth: false }),

  listTeam: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/team`),
  updateTeamMemberRole: (lifeSpaceId, memberId, role) =>
    request(`/lifespaces/${lifeSpaceId}/team/${memberId}`, { method: "PATCH", body: { role } }),
  removeTeamMember: (lifeSpaceId, memberId) =>
    request(`/lifespaces/${lifeSpaceId}/team/${memberId}`, { method: "DELETE" }),

  listInvitations: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/invitations`),
  createInvitation: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/invitations`, { method: "POST", body: payload }),
  revokeInvitation: (lifeSpaceId, invitationId) =>
    request(`/lifespaces/${lifeSpaceId}/invitations/${invitationId}`, { method: "DELETE" }),
  listPendingInvitationsForMe: () => request("/invitations/pending"),
  acceptInvitation: (invitationId) => request(`/invitations/${invitationId}/accept`, { method: "POST" }),
  declineInvitation: (invitationId) => request(`/invitations/${invitationId}/decline`, { method: "POST" }),

  listTasks: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/tasks`),
  createTask: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/tasks`, { method: "POST", body: payload }),
  updateTask: (id, payload) => request(`/tasks/${id}`, { method: "PATCH", body: payload }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
  addTaskDependency: (id, dependencyTaskId) => request(`/tasks/${id}/dependencies`, { method: "POST", body: { dependencyTaskId } }),
  replaceTaskDependencies: (id, dependencyTaskIds) => request(`/tasks/${id}/dependencies`, { method: "PUT", body: { dependencyTaskIds } }),
  removeTaskDependency: (id, dependencyTaskId) => request(`/tasks/${id}/dependencies/${dependencyTaskId}`, { method: "DELETE" }),

  listNotifications: (lifeSpaceId, { unreadOnly, filter, type, q, before, cursor, limit } = {}) => {
    const params = new URLSearchParams();
    if (unreadOnly) params.set("unreadOnly", "true");
    if (filter) params.set("filter", filter);
    if (type) params.set("type", type);
    if (q) params.set("q", q);
    if (before) params.set("before", before);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", limit);
    const qs = params.toString();
    return request(`/lifespaces/${lifeSpaceId}/notifications${qs ? `?${qs}` : ""}`);
  },
  getUnreadNotificationCount: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/notifications/unread-count`),
  markAllNotificationsRead: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/notifications/mark-all-read`, { method: "POST" }),
  setNotificationRead: (id, read) => request(`/notifications/${id}`, { method: "PATCH", body: { read } }),
  deleteNotification: (id) => request(`/notifications/${id}`, { method: "DELETE" }),
  restoreNotification: (id) => request(`/notifications/${id}/restore`, { method: "POST" }),

  listAuditLogs: (lifeSpaceId, filters = {}) => {
    const params = new URLSearchParams();
    for (const key of ["action", "resourceType", "actorId", "from", "to", "cursor", "limit"]) {
      if (filters[key]) params.set(key, filters[key]);
    }
    const query = params.toString();
    return request(`/lifespaces/${lifeSpaceId}/audit-logs${query ? `?${query}` : ""}`);
  },
  getAuditFilterOptions: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/audit-logs/filter-options`),
};

export { getToken };
