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
  created_at    TIMESTAMP DEFAULT now()
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
