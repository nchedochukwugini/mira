ALTER TABLE panta_trade_scans
  ADD COLUMN IF NOT EXISTS backfill_signature text;
