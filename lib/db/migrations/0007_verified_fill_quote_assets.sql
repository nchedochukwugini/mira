ALTER TABLE panta_matched_fills
  ADD COLUMN quote_asset_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN quote_mint text,
  ADD COLUMN quote_symbol text,
  ADD COLUMN quote_decimals smallint,
  ADD COLUMN quote_network text,
  ADD COLUMN quote_source text,
  ADD COLUMN quote_asset_reason text,
  ADD COLUMN price_units numeric(20,0),
  ADD COLUMN share_quantity_units numeric(20,0),
  ADD COLUMN price_scale numeric(20,0),
  ADD COLUMN share_quantity_scale numeric(20,0),
  ADD COLUMN quote_notional numeric(50,15),
  ADD COLUMN quote_notional_mint text,
  ADD COLUMN quote_notional_status text NOT NULL DEFAULT 'unavailable';

ALTER TABLE panta_matched_fills
  ADD CONSTRAINT panta_fills_quote_asset_status_check CHECK (quote_asset_status IN ('verified','unknown','unsupported')),
  ADD CONSTRAINT panta_fills_quote_notional_status_check CHECK (quote_notional_status IN ('calculated','unavailable','unverified')),
  ADD CONSTRAINT panta_fills_quote_decimals_check CHECK (quote_decimals IS NULL OR (quote_decimals >= 0 AND quote_decimals <= 18));

UPDATE panta_matched_fills
SET quote_asset_status='unknown',
    quote_asset_reason='Legacy usdc_value denomination was not verified from the trade instruction and on-chain quote-mint configuration.',
    quote_notional_status='unverified'
WHERE quote_asset_status='unknown';

COMMENT ON COLUMN panta_matched_fills.usdc_value IS 'Legacy compatibility field. Historical values have unverified denomination and must not be used as USDC notional.';
COMMENT ON COLUMN panta_matched_fills.quote_notional IS 'Exact price-times-share quantity in quote-token units; only usable when quote_asset_status=verified and quote_notional_mint=quote_mint.';
CREATE INDEX panta_fills_quote_mint_time_idx ON panta_matched_fills(market_id,quote_mint,block_time DESC) WHERE quote_asset_status='verified';
