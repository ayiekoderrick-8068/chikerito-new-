const { v4: uuid } = require("uuid");
const db = require("./db");

const SECRET_KEY = /(password|passcode|token|secret|authorization|cookie|session|credential|api.?key|hash)/i;
const MAX_STRING = 200;
const MAX_ARRAY = 20;

function sanitizeValue(value, depth = 0) {
  if (depth > 4 || value === undefined || typeof value === "function") return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      const sanitized = sanitizeValue(item, depth + 1);
      if (sanitized !== undefined) clean[key] = sanitized;
    }
    return clean;
  }
  return String(value).slice(0, MAX_STRING);
}

function actorName(user) {
  if (!user) return "Public visitor";
  const stored = user.id ? db.table("users").find(user.id) : null;
  const first = user.first_name || user.firstName || stored?.first_name || "";
  const last = user.last_name || user.lastName || stored?.last_name || "";
  return `${first} ${last}`.trim() || "Authenticated user";
}

function writeAudit({ lifeSpaceId, actor, action, resourceType, resourceId, metadata = {}, occurredAt }) {
  if (!lifeSpaceId || !action || !resourceType) return null;
  return db.table("audit_logs").insert({
    id: uuid(),
    life_space_id: lifeSpaceId,
    actor_id: actor ? actor.id : null,
    actor_name: actorName(actor),
    action,
    resource_type: resourceType,
    resource_id: resourceId || null,
    metadata: sanitizeValue(metadata) || {},
    occurred_at: occurredAt || new Date().toISOString(),
  });
}

const COLLECTIONS = {
  categories: { table: "budget_categories", type: "category", bodyKey: "category" },
  expenses: { table: "expenses", type: "expense", bodyKey: "expense" },
  contributions: { table: "contributions", type: "contribution", bodyKey: "contribution" },
  tasks: { table: "tasks", type: "task", bodyKey: "task" },
  "recurring-expenses": { table: "recurring_expenses", type: "recurring_expense", bodyKey: "recurringExpense" },
  invitations: { table: "invitations", type: "invitation", bodyKey: "invitation" },
};

const RESOURCE_PATHS = {
  categories: COLLECTIONS.categories,
  expenses: COLLECTIONS.expenses,
  contributions: COLLECTIONS.contributions,
  tasks: COLLECTIONS.tasks,
  "recurring-expenses": COLLECTIONS["recurring-expenses"],
};

function visibleChangedFields(body) {
  return Object.keys(body || {}).filter((key) => !SECRET_KEY.test(key)).sort();
}

function usefulMetadata(req, responseBody, snapshot) {
  const responseResource = responseBody && Object.values(COLLECTIONS)
    .map((entry) => responseBody[entry.bodyKey])
    .find(Boolean);
  const resource = responseResource || snapshot;
  const metadata = {
    changed_fields: visibleChangedFields(req.body),
    request_method: req.method,
  };
  if (resource) {
    if (resource.title) metadata.label = resource.title;
    else if (resource.name) metadata.label = resource.name;
    else if (resource.vendor) metadata.label = resource.vendor;
    if (resource.status) metadata.status = resource.status;
  }
  if (req.body && req.body.role) metadata.role = req.body.role;
  return metadata;
}

function describeMutation(req, responseBody, snapshot) {
  const path = req.path.replace(/^\/api/, "");
  let match = path.match(/^\/lifespaces\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (match) {
    const [, lifeSpaceId, collection, resourceId, operation] = match;
    if (collection === "team" && resourceId) {
      return {
        lifeSpaceId,
        action: req.method === "DELETE" ? "team_member.removed" : "team_member.role_updated",
        resourceType: "team_member",
        resourceId,
      };
    }
    const config = COLLECTIONS[collection];
    if (!config) return null;
    if (req.method === "POST" && !resourceId) {
      const resource = responseBody && responseBody[config.bodyKey];
      return { lifeSpaceId, action: `${config.type}.created`, resourceType: config.type, resourceId: resource && resource.id };
    }
    if (req.method === "DELETE" && collection === "invitations") {
      return { lifeSpaceId, action: "invitation.revoked", resourceType: "invitation", resourceId };
    }
    if (operation) return null;
  }

  match = path.match(/^\/lifespaces\/([^/]+)$/);
  if (match) {
    const lifeSpace = responseBody && responseBody.lifeSpace;
    if (req.method === "PATCH") return { lifeSpaceId: match[1], action: "life_space.updated", resourceType: "life_space", resourceId: match[1] };
    if (req.method === "DELETE") return { lifeSpaceId: match[1], action: "life_space.deleted", resourceType: "life_space", resourceId: match[1] };
  }
  if (path === "/lifespaces" && req.method === "POST") {
    const lifeSpace = responseBody && responseBody.lifeSpace;
    return lifeSpace && { lifeSpaceId: lifeSpace.id, action: "life_space.created", resourceType: "life_space", resourceId: lifeSpace.id };
  }

  match = path.match(/^\/(categories|expenses|contributions|tasks|recurring-expenses)\/([^/]+)(?:\/([^/]+))?$/);
  if (match) {
    const [, collection, id, operation] = match;
    const config = RESOURCE_PATHS[collection];
    const lifeSpaceId = snapshot && snapshot.life_space_id;
    if (!lifeSpaceId) return null;
    let verb = req.method === "DELETE" ? "deleted" : "updated";
    if (operation === "pause") verb = "paused";
    if (operation === "resume") verb = "resumed";
    return { lifeSpaceId, action: `${config.type}.${verb}`, resourceType: config.type, resourceId: id };
  }

  match = path.match(/^\/invitations\/([^/]+)\/(accept|decline)$/);
  if (match && snapshot) {
    return {
      lifeSpaceId: snapshot.life_space_id,
      action: `invitation.${match[2] === "accept" ? "accepted" : "declined"}`,
      resourceType: "invitation",
      resourceId: match[1],
    };
  }
  return null;
}

function snapshotFor(req) {
  const path = req.path.replace(/^\/api/, "");
  let match = path.match(/^\/(categories|expenses|contributions|tasks|recurring-expenses)\/([^/]+)/);
  if (match) return db.table(RESOURCE_PATHS[match[1]].table).find(match[2]);
  match = path.match(/^\/invitations\/([^/]+)\/(?:accept|decline)$/);
  if (match) return db.table("invitations").find(match[1]);
  match = path.match(/^\/lifespaces\/([^/]+)\/invitations\/([^/]+)$/);
  if (match) return db.table("invitations").find(match[2]);
  match = path.match(/^\/lifespaces\/([^/]+)\/team\/([^/]+)$/);
  if (match) return db.table("team_members").find(match[2]);
  match = path.match(/^\/lifespaces\/([^/]+)$/);
  if (match) return db.table("life_spaces").find(match[1]);
  return null;
}

function auditMutations(req, res, next) {
  if (!["POST", "PATCH", "DELETE"].includes(req.method) || req.path.includes("/audit-logs")) return next();
  // Mounted Express routers temporarily rewrite req.url (and therefore
  // req.path) while handling a request. The finish event fires before that
  // mount state is restored, so retain the application-level path now.
  const originalPath = req.path;
  const snapshot = snapshotFor(req);
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const descriptor = describeMutation({ path: originalPath, method: req.method, body: req.body }, responseBody, snapshot);
    if (!descriptor) return;
    // Permanent life-space deletion purges its audit history. Do not recreate
    // an orphan record after the response has completed.
    if (descriptor.action === "life_space.deleted" && !db.table("life_spaces").find(descriptor.lifeSpaceId)) return;
    writeAudit({
      ...descriptor,
      actor: req.user || null,
      metadata: usefulMetadata(req, responseBody, snapshot),
    });
  });
  next();
}

module.exports = { SECRET_KEY, sanitizeValue, writeAudit, auditMutations, describeMutation };
