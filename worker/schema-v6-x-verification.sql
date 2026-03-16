-- Add X verification columns to guardian_verification_sessions
ALTER TABLE guardian_verification_sessions ADD COLUMN x_handle TEXT;
ALTER TABLE guardian_verification_sessions ADD COLUMN verification_code TEXT;
ALTER TABLE guardian_verification_sessions ADD COLUMN tweet_url TEXT;

-- Add unique index on x_handle for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_gvs_x_handle ON guardian_verification_sessions(x_handle);

-- Add X columns to guardians
ALTER TABLE guardians ADD COLUMN x_handle TEXT;
ALTER TABLE guardians ADD COLUMN tweet_url TEXT;
