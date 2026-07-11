INSERT INTO platform_settings (key, value)
VALUES
  ('p2p_taker_fee_basic_percent', '0.5'::jsonb),
  ('p2p_taker_fee_verified_percent', '0.35'::jsonb),
  ('p2p_taker_fee_merchant_percent', '0.15'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS maker_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS taker_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS taker_tier TEXT,
  ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(10, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(28, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_amount NUMERIC(28, 8),
  ADD COLUMN IF NOT EXISTS buyer_receive_amount NUMERIC(28, 8);

UPDATE trades t
SET maker_id = COALESCE(t.maker_id, o.user_id), taker_id = COALESCE(t.taker_id, CASE WHEN o.side = 'sell' THEN t.buyer_id ELSE t.seller_id END),
    taker_tier = COALESCE(t.taker_tier, 'legacy'), escrow_amount = COALESCE(t.escrow_amount, t.asset_amount),
    buyer_receive_amount = COALESCE(t.buyer_receive_amount, t.asset_amount)
FROM offers o WHERE o.id = t.offer_id;

ALTER TABLE trades ALTER COLUMN escrow_amount SET NOT NULL, ALTER COLUMN buyer_receive_amount SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_taker_created ON trades(taker_id, created_at DESC);
