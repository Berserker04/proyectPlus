PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scanned_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  runtime_type TEXT NOT NULL,
  framework_type TEXT NOT NULL,
  expected_port INTEGER,
  detected_port INTEGER,
  start_command TEXT,
  stop_strategy TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'autodiscovery',
  auto_detected INTEGER NOT NULL DEFAULT 1,
  last_known_status TEXT NOT NULL DEFAULT 'stopped',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_workspace_id ON service(workspace_id);
CREATE INDEX IF NOT EXISTS idx_service_name ON service(name);

CREATE TABLE IF NOT EXISTS process_instance (
  id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL,
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
  gpu_percent REAL,
  gpu_memory_bytes INTEGER,
  FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_process_service_id ON process_instance(service_id);

CREATE TABLE IF NOT EXISTS k6_script (
  id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'autodiscovery',
  default_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_k6_script_service_id ON k6_script(service_id);

CREATE TABLE IF NOT EXISTS k6_run (
  id TEXT PRIMARY KEY NOT NULL,
  service_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  raw_result_path TEXT,
  FOREIGN KEY (service_id) REFERENCES service(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES k6_script(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_k6_run_service_id ON k6_run(service_id);
CREATE INDEX IF NOT EXISTS idx_k6_run_script_id ON k6_run(script_id);

CREATE TABLE IF NOT EXISTS user_preference (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preference_scope ON user_preference(scope_type, scope_id);
