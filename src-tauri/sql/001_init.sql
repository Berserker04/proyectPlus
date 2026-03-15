PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_project_updated_at ON project(updated_at DESC);

CREATE TABLE IF NOT EXISTS microservice (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  start_command TEXT NOT NULL DEFAULT '',
  expected_port INTEGER,
  detected_port INTEGER,
  last_known_status TEXT NOT NULL DEFAULT 'stopped',
  last_signal_text TEXT NOT NULL DEFAULT '',
  last_issue_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_microservice_project_id ON microservice(project_id);
CREATE INDEX IF NOT EXISTS idx_microservice_name ON microservice(name);

CREATE TABLE IF NOT EXISTS process_instance (
  id TEXT PRIMARY KEY NOT NULL,
  microservice_id TEXT NOT NULL,
  trigger_action TEXT NOT NULL DEFAULT 'run',
  command_line TEXT NOT NULL DEFAULT '',
  pid INTEGER,
  detected_port INTEGER,
  status TEXT NOT NULL,
  started_at TEXT,
  stopped_at TEXT,
  last_signal_text TEXT NOT NULL DEFAULT '',
  last_issue_json TEXT NOT NULL DEFAULT 'null',
  cpu_percent REAL NOT NULL DEFAULT 0,
  memory_bytes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (microservice_id) REFERENCES microservice(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_process_microservice_id ON process_instance(microservice_id);

CREATE TABLE IF NOT EXISTS user_preference (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preference_scope ON user_preference(scope_type, scope_id);
