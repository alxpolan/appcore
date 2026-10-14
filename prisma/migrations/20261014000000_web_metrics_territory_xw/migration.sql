-- Move private-web campaign metrics rows from "ZZ" to "XW" (ISO 3166-1 user-assigned).
-- Web rows are the only ones carrying trials/purchases/proceeds; official "ZZ"
-- rows (downloads-only, Apple reported no territory) stay untouched so the two
-- sources never share an upsert key again.
UPDATE "AppStoreCampaignMetrics"
SET "territory" = 'XW'
WHERE "territory" = 'ZZ'
  AND ("trials" > 0 OR "purchases" > 0 OR "proceedsUsd" > 0);
