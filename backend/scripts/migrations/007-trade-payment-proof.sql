ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_proof_name text,
  ADD COLUMN IF NOT EXISTS payment_proof_mime_type text;
