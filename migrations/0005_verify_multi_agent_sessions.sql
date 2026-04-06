DROP INDEX IF EXISTS idx_gvs_x_handle;

CREATE INDEX IF NOT EXISTS idx_gvs_handle_status
  ON guardian_verification_sessions(x_handle, status);

CREATE INDEX IF NOT EXISTS idx_gvs_handle_agent_status
  ON guardian_verification_sessions(x_handle, agent_name COLLATE NOCASE, status);
