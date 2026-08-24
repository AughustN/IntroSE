-- Migration 0038 — A fourth advertising package.
--
-- Depends on 0033_ads.sql (ad_packages).
--
-- The purchase screen lays its cards out two-by-two; three packages left the grid lopsided. The
-- new row also fills a real gap in the ladder: between "hot rail only, 7 days" (2M) and the full
-- combo (5M/14d) there was no trailer-ONLY option for an organizer whose event has a good video
-- but no need to lead with it forever.
--
-- display_order shifts so the four read cheapest-first: basic(1), trailer(2), featured(3), premium(4).
BEGIN;

INSERT INTO ad_packages (code, name_vi, description_vi, price_amount, duration_days, placements, display_order)
VALUES ('trailer', 'Gói Trailer',
        'Trailer sự kiện được chiếu ngay đầu trang chủ trong 10 ngày.',
        3500000, 10, ARRAY['hero_trailer']::TEXT[], 2)
ON CONFLICT (code) DO NOTHING;

UPDATE ad_packages SET display_order = 3 WHERE code = 'featured';
UPDATE ad_packages SET display_order = 4 WHERE code = 'premium';

COMMIT;
