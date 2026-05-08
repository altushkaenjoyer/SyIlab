-- Migration: add_baseline_lock_trigger
-- Enforces baseline immutability at DB level (belt-and-suspenders alongside Prisma middleware)

CREATE OR REPLACE FUNCTION prevent_baseline_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'baseline_sessions record % is locked and cannot be modified', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER baseline_lock_guard
  BEFORE UPDATE ON baseline_sessions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_baseline_update();
