-- Chikerito relational schema (reference design for Postgres/MySQL in production).
-- The bundled dev server uses an equivalent JSON document store (db.js) so this
-- project runs with zero native dependencies; swap db.js for a real driver
-- against this schema when moving to production.

CREATE TABLE users (
  id            UUID PRIMARY KEY,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY, -- also embedded as the JWT's `sid` claim; revoking a row invalidates that token
  user_id       UUID REFERENCES users(id),
  user_agent    VARCHAR(500),
  created_at    TIMESTAMP DEFAULT now(),
  last_seen_at  TIMESTAMP DEFAULT now(),
  revoked_at    TIMESTAMP
);

CREATE TABLE password_resets (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  token_hash    VARCHAR(64) NOT NULL, -- sha256 hex digest of the raw token; the raw token is never stored
  status        VARCHAR(20) DEFAULT 'pending', -- pending | used | revoked (expiry is derived from expires_at, not stored)
  created_at    TIMESTAMP DEFAULT now(),
  expires_at    TIMESTAMP NOT NULL,
  used_at       TIMESTAMP
);

CREATE TABLE life_spaces (
  id             UUID PRIMARY KEY,
  owner_id       UUID REFERENCES users(id),
  title          VARCHAR(255) NOT NULL,
  milestone_type VARCHAR(50) NOT NULL,       -- wedding, graduation, medical, business, ...
  story          TEXT,
  goal_amount    NUMERIC(12,2) DEFAULT 0,
  currency       VARCHAR(10) DEFAULT 'USD',
  theme          VARCHAR(50) DEFAULT 'classic',
  visibility     VARCHAR(10) DEFAULT 'private',   -- private | public — controls public page + donate link access
  show_budget_public BOOLEAN DEFAULT false,        -- when public, whether budget/expense breakdown is included
  allow_indexing BOOLEAN DEFAULT false,            -- when public, whether to allow search engines to index the page
  passcode_hash  VARCHAR(255),                     -- bcrypt hash; null = no passcode required for the public page
  cover_image    VARCHAR(500),
  slug           VARCHAR(255) UNIQUE,
  status         VARCHAR(20) DEFAULT 'active',    -- active | completed | archived
  created_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE team_members (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  user_id       UUID REFERENCES users(id),
  role          VARCHAR(30) NOT NULL, -- owner | finance_manager | event_planner | volunteer | editor
  invited_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE invitations (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  email         VARCHAR(255) NOT NULL,
  role          VARCHAR(30) NOT NULL, -- finance_manager | event_planner | volunteer | editor — never owner
  status        VARCHAR(20) DEFAULT 'pending', -- pending | accepted | declined | revoked (expiry is derived from expires_at, not stored)
  invited_by    UUID REFERENCES users(id),
  invited_at    TIMESTAMP DEFAULT now(),
  expires_at    TIMESTAMP NOT NULL,
  responded_at  TIMESTAMP
);

CREATE TABLE budget_categories (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  name          VARCHAR(120) NOT NULL,
  icon          VARCHAR(50),
  budget_amount NUMERIC(12,2) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE contributions (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  category_id   UUID REFERENCES budget_categories(id) NULL,
  contributor_name VARCHAR(120) DEFAULT 'Anonymous',
  amount        NUMERIC(12,2) NOT NULL,
  message       TEXT,
  payment_method VARCHAR(30) DEFAULT 'card',
  status        VARCHAR(20) DEFAULT 'completed', -- pending | completed | failed | refunded
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE expenses (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  category_id   UUID REFERENCES budget_categories(id),
  vendor        VARCHAR(255),
  planned_amount NUMERIC(12,2) DEFAULT 0, -- what this line item was budgeted for, before it's actually paid
  amount        NUMERIC(12,2) NOT NULL,   -- actual amount paid/owed so far (0 if still only planned)
  invoice_url   VARCHAR(500),
  receipt_url   VARCHAR(500),
  payment_date  DATE,
  status        VARCHAR(20) DEFAULT 'paid', -- pending | paid | overdue
  notes         TEXT,
  recurring_expense_id UUID REFERENCES recurring_expenses(id), -- set only for auto-generated occurrences
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE recurring_expenses (
  id                UUID PRIMARY KEY,
  life_space_id     UUID REFERENCES life_spaces(id),
  category_id       UUID REFERENCES budget_categories(id) NULL,
  vendor            VARCHAR(255) NOT NULL,
  amount            NUMERIC(12,2) NOT NULL, -- must be > 0
  frequency         VARCHAR(20) NOT NULL,   -- weekly | biweekly | monthly | quarterly | yearly
  start_date        DATE NOT NULL,
  end_date          DATE,                  -- null = no end
  status            VARCHAR(20) DEFAULT 'active', -- active | paused | stopped
  last_generated_date DATE,                -- date of the most recently materialized occurrence; null until the first run
  created_at        TIMESTAMP DEFAULT now()
);

CREATE TABLE tasks (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  title         VARCHAR(255) NOT NULL,
  category      VARCHAR(120) DEFAULT 'General', -- Venue, Photography, Cake, Dress, Decor, Music, ...
  due_date      DATE,
  completed     BOOLEAN DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE notifications (
  id            UUID PRIMARY KEY,
  life_space_id UUID REFERENCES life_spaces(id),
  type          VARCHAR(30) NOT NULL, -- donation | budget_warning | milestone_funded | expense_added
  message       TEXT NOT NULL,
  read          BOOLEAN DEFAULT false,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE notification_user_states (
  id              UUID PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES notifications(id),
  life_space_id   UUID NOT NULL REFERENCES life_spaces(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  read            BOOLEAN DEFAULT false,
  dismissed       BOOLEAN DEFAULT false,
  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(notification_id, user_id)
);
