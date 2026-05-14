-- Add email verification fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "verificationToken" TEXT;

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT        NOT NULL PRIMARY KEY,
  "userId"    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "tokenHash" TEXT        NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx"    ON password_reset_tokens("userId");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_idx" ON password_reset_tokens("tokenHash");
