BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL CHECK (data->>'id' = id::text),
  email TEXT GENERATED ALWAYS AS (lower(data->>'email')) STORED UNIQUE
);

CREATE TABLE IF NOT EXISTS life_spaces (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL CHECK (data->>'id' = id::text),
  owner_id UUID GENERATED ALWAYS AS ((data->>'owner_id')::uuid) STORED REFERENCES users(id),
  slug TEXT GENERATED ALWAYS AS (data->>'slug') STORED UNIQUE,
  CHECK (data->>'status' IS NULL OR data->>'status' IN ('active', 'completed', 'archived'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL CHECK (data->>'id' = id::text),
  user_id UUID GENERATED ALWAYS AS ((data->>'user_id')::uuid) STORED NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL CHECK (data->>'id' = id::text),
  user_id UUID GENERATED ALWAYS AS ((data->>'user_id')::uuid) STORED NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  user_id UUID GENERATED ALWAYS AS ((data->>'user_id')::uuid) STORED NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (life_space_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  provider_event_id TEXT GENERATED ALWAYS AS (data->>'provider_event_id') STORED,
  CHECK (data->>'status' IS NULL OR data->>'status' IN ('pending','completed','failed','refunded','voided'))
);
CREATE UNIQUE INDEX IF NOT EXISTS contributions_provider_event_unique ON contributions(provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS recurring_expense_exceptions (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  recurring_expense_id UUID GENERATED ALWAYS AS ((data->>'recurring_expense_id')::uuid) STORED NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  occurrence_date TEXT GENERATED ALWAYS AS (data->>'occurrence_date') STORED,
  UNIQUE (recurring_expense_id, occurrence_date)
);
CREATE TABLE IF NOT EXISTS budget_scenarios (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS budget_scenario_adjustments (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  scenario_id UUID GENERATED ALWAYS AS ((data->>'scenario_id')::uuid) STORED NOT NULL REFERENCES budget_scenarios(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  task_id UUID GENERATED ALWAYS AS ((data->>'task_id')::uuid) STORED NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_task_id UUID GENERATED ALWAYS AS ((data->>'dependency_task_id')::uuid) STORED NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE (task_id, dependency_task_id), CHECK (task_id <> dependency_task_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notification_user_states (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE,
  user_id UUID GENERATED ALWAYS AS ((data->>'user_id')::uuid) STORED NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id UUID GENERATED ALWAYS AS ((data->>'notification_id')::uuid) STORED NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  UNIQUE (notification_id, user_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY, data JSONB NOT NULL CHECK (data->>'id' = id::text),
  life_space_id UUID GENERATED ALWAYS AS ((data->>'life_space_id')::uuid) STORED NOT NULL REFERENCES life_spaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS invitations_space_idx ON invitations(life_space_id);
CREATE INDEX IF NOT EXISTS categories_space_idx ON budget_categories(life_space_id);
CREATE INDEX IF NOT EXISTS contributions_space_idx ON contributions(life_space_id);
CREATE INDEX IF NOT EXISTS expenses_space_idx ON expenses(life_space_id);
CREATE INDEX IF NOT EXISTS recurring_expenses_space_idx ON recurring_expenses(life_space_id);
CREATE INDEX IF NOT EXISTS tasks_space_idx ON tasks(life_space_id);
CREATE INDEX IF NOT EXISTS notifications_space_idx ON notifications(life_space_id);
CREATE INDEX IF NOT EXISTS audit_logs_space_idx ON audit_logs(life_space_id);

COMMIT;
