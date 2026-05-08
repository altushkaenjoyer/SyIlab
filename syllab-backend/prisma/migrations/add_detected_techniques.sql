-- Migration: add_detected_techniques
-- Adds detected_techniques column to submission_features for genealogy history tracking.
-- Allows the system to know ALL techniques a student has used in past submissions,
-- not just the ones that caused violations.

ALTER TABLE submission_features
  ADD COLUMN IF NOT EXISTS detected_techniques TEXT[] NOT NULL DEFAULT '{}';
