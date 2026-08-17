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

  listLifeSpaces: () => request("/lifespaces"),
  createLifeSpace: (payload) => request("/lifespaces", { method: "POST", body: payload }),
  getLifeSpace: (id) => request(`/lifespaces/${id}`),
  updateLifeSpace: (id, payload) => request(`/lifespaces/${id}`, { method: "PATCH", body: payload }),
  getDashboard: (id) => request(`/lifespaces/${id}/dashboard`),
  getPublicReport: (slug, passcode) => request(withPasscode(`/public/lifespaces/${slug}/report`, passcode), { auth: false }),

  listCategories: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/categories`),
  createCategory: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/categories`, { method: "POST", body: payload }),
  updateCategory: (id, payload) => request(`/categories/${id}`, { method: "PATCH", body: payload }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: "DELETE" }),

  listExpenses: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/expenses`),
  createExpense: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/expenses`, { method: "POST", body: payload }),
  updateExpense: (id, payload) => request(`/expenses/${id}`, { method: "PATCH", body: payload }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),

  listContributions: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/contributions`),
  publicContribute: (slug, payload, passcode) =>
    request(withPasscode(`/public/lifespaces/${slug}/contribute`, passcode), { method: "POST", body: payload, auth: false }),

  listTeam: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/team`),
  inviteTeam: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/team`, { method: "POST", body: payload }),
  updateTeamMemberRole: (lifeSpaceId, memberId, role) =>
    request(`/lifespaces/${lifeSpaceId}/team/${memberId}`, { method: "PATCH", body: { role } }),
  removeTeamMember: (lifeSpaceId, memberId) =>
    request(`/lifespaces/${lifeSpaceId}/team/${memberId}`, { method: "DELETE" }),

  listTasks: (lifeSpaceId) => request(`/lifespaces/${lifeSpaceId}/tasks`),
  createTask: (lifeSpaceId, payload) => request(`/lifespaces/${lifeSpaceId}/tasks`, { method: "POST", body: payload }),
  updateTask: (id, payload) => request(`/tasks/${id}`, { method: "PATCH", body: payload }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
};

export { getToken };
