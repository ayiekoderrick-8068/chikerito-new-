// Mirrors backend/middleware/authorize.js's CAPABILITIES table. Frontend
// guards are UX only — hiding/disabling actions a role can't perform — the
// backend is the actual enforcement boundary and re-checks every request.
const CAPABILITIES = {
  "lifespace:edit_settings": ["owner", "finance_manager", "event_planner", "editor"],
  "lifespace:edit_visibility": ["owner"],
  "lifespace:delete": ["owner"],
  "category:manage": ["owner", "finance_manager"],
  "expense:manage": ["owner", "finance_manager"],
  "scenario:manage": ["owner", "finance_manager"],
  "task:manage": ["owner", "event_planner"],
  "team:manage": ["owner"],
  "audit:view": ["owner", "finance_manager"],
};

export function can(role, capability) {
  return !!role && (CAPABILITIES[capability] || []).includes(role);
}
