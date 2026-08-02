/*
 Navicat Premium Dump SQL

 Source Server         : neondb_owner
 Source Server Type    : PostgreSQL
 Source Server Version : 180004 (180004)
 Source Host           : ep-small-mountain-azafopc7-pooler.c-3.ap-southeast-1.aws.neon.tech:5432
 Source Catalog        : neondb
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 180004 (180004)
 File Encoding         : 65001

 Date: 01/08/2026 07:46:39
*/


-- ----------------------------
-- Sequence structure for event_categories_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."event_categories_id_seq";
CREATE SEQUENCE "public"."event_categories_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 32767
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for event_views_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."event_views_id_seq";
CREATE SEQUENCE "public"."event_views_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for events_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."events_id_seq";
CREATE SEQUENCE "public"."events_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for notifications_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."notifications_id_seq";
CREATE SEQUENCE "public"."notifications_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for orders_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."orders_id_seq";
CREATE SEQUENCE "public"."orders_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for organizers_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."organizers_id_seq";
CREATE SEQUENCE "public"."organizers_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for payment_transactions_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."payment_transactions_id_seq";
CREATE SEQUENCE "public"."payment_transactions_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for refund_requests_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."refund_requests_id_seq";
CREATE SEQUENCE "public"."refund_requests_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for reservation_items_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."reservation_items_id_seq";
CREATE SEQUENCE "public"."reservation_items_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for reservations_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."reservations_id_seq";
CREATE SEQUENCE "public"."reservations_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for reviews_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."reviews_id_seq";
CREATE SEQUENCE "public"."reviews_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for seats_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."seats_id_seq";
CREATE SEQUENCE "public"."seats_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for sections_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."sections_id_seq";
CREATE SEQUENCE "public"."sections_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for showtime_seats_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."showtime_seats_id_seq";
CREATE SEQUENCE "public"."showtime_seats_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for showtimes_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."showtimes_id_seq";
CREATE SEQUENCE "public"."showtimes_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for ticket_tiers_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."ticket_tiers_id_seq";
CREATE SEQUENCE "public"."ticket_tiers_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for tickets_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."tickets_id_seq";
CREATE SEQUENCE "public"."tickets_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for users_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."users_id_seq";
CREATE SEQUENCE "public"."users_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for venues_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."venues_id_seq";
CREATE SEQUENCE "public"."venues_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for vouchers_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."vouchers_id_seq";
CREATE SEQUENCE "public"."vouchers_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Sequence structure for waitlists_id_seq
-- ----------------------------
DROP SEQUENCE IF EXISTS "public"."waitlists_id_seq";
CREATE SEQUENCE "public"."waitlists_id_seq" 
INCREMENT 1
MINVALUE  1
MAXVALUE 9223372036854775807
START 1
CACHE 1;

-- ----------------------------
-- Table structure for event_categories
-- ----------------------------
DROP TABLE IF EXISTS "public"."event_categories";
CREATE TABLE "public"."event_categories" (
  "id" int2 NOT NULL DEFAULT nextval('event_categories_id_seq'::regclass),
  "code" text COLLATE "pg_catalog"."default" NOT NULL,
  "label_vi" text COLLATE "pg_catalog"."default" NOT NULL,
  "label_en" text COLLATE "pg_catalog"."default"
)
;

-- ----------------------------
-- Records of event_categories
-- ----------------------------

-- ----------------------------
-- Table structure for event_views
-- ----------------------------
DROP TABLE IF EXISTS "public"."event_views";
CREATE TABLE "public"."event_views" (
  "id" int8 NOT NULL DEFAULT nextval('event_views_id_seq'::regclass),
  "user_id" int8,
  "event_id" int8 NOT NULL,
  "viewed_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of event_views
-- ----------------------------

-- ----------------------------
-- Table structure for events
-- ----------------------------
DROP TABLE IF EXISTS "public"."events";
CREATE TABLE "public"."events" (
  "id" int8 NOT NULL DEFAULT nextval('events_id_seq'::regclass),
  "slug" text COLLATE "pg_catalog"."default" NOT NULL,
  "organizer_id" int8 NOT NULL,
  "category_id" int2 NOT NULL,
  "title" text COLLATE "pg_catalog"."default" NOT NULL,
  "original_title" text COLLATE "pg_catalog"."default",
  "description" text COLLATE "pg_catalog"."default" NOT NULL,
  "age_rating" text COLLATE "pg_catalog"."default",
  "age_description" text COLLATE "pg_catalog"."default",
  "duration_minutes" int4,
  "genre" text[] COLLATE "pg_catalog"."default" NOT NULL DEFAULT '{}'::text[],
  "cast_names" text[] COLLATE "pg_catalog"."default" NOT NULL DEFAULT '{}'::text[],
  "release_date" date,
  "rating" numeric(3,1),
  "review_count" int4 NOT NULL DEFAULT 0,
  "image_url" text COLLATE "pg_catalog"."default",
  "local_image_path" text COLLATE "pg_catalog"."default",
  "trailer_url" text COLLATE "pg_catalog"."default",
  "refund_policy" text COLLATE "pg_catalog"."default",
  "is_featured" bool NOT NULL DEFAULT false,
  "location_type" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'physical'::text,
  "online_url" text COLLATE "pg_catalog"."default",
  "event_type" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'general_admission'::text,
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'draft'::text,
  "moderation_status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending_review'::text,
  "seo_title" text COLLATE "pg_catalog"."default",
  "seo_description" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of events
-- ----------------------------

-- ----------------------------
-- Table structure for notifications
-- ----------------------------
DROP TABLE IF EXISTS "public"."notifications";
CREATE TABLE "public"."notifications" (
  "id" int8 NOT NULL DEFAULT nextval('notifications_id_seq'::regclass),
  "user_id" int8 NOT NULL,
  "type" text COLLATE "pg_catalog"."default" NOT NULL,
  "channel" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'in_app'::text,
  "title" text COLLATE "pg_catalog"."default" NOT NULL,
  "body" text COLLATE "pg_catalog"."default",
  "payload" jsonb,
  "sent_at" timestamptz(6),
  "read_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of notifications
-- ----------------------------

-- ----------------------------
-- Table structure for orders
-- ----------------------------
DROP TABLE IF EXISTS "public"."orders";
CREATE TABLE "public"."orders" (
  "id" int8 NOT NULL DEFAULT nextval('orders_id_seq'::regclass),
  "order_code" text COLLATE "pg_catalog"."default" NOT NULL,
  "user_id" int8,
  "reservation_id" int8 NOT NULL,
  "customer_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "customer_email" text COLLATE "pg_catalog"."default" NOT NULL,
  "customer_phone" text COLLATE "pg_catalog"."default" NOT NULL,
  "subtotal_cents" int8 NOT NULL,
  "service_fee_cents" int8 NOT NULL,
  "discount_cents" int8 NOT NULL DEFAULT 0,
  "final_total_cents" int8 NOT NULL,
  "payment_method" text COLLATE "pg_catalog"."default" NOT NULL,
  "payment_status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::text,
  "voucher_id" int8,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of orders
-- ----------------------------

-- ----------------------------
-- Table structure for organizers
-- ----------------------------
DROP TABLE IF EXISTS "public"."organizers";
CREATE TABLE "public"."organizers" (
  "id" int8 NOT NULL DEFAULT nextval('organizers_id_seq'::regclass),
  "user_id" int8 NOT NULL,
  "display_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "logo_url" text COLLATE "pg_catalog"."default",
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::text,
  "applied_at" timestamptz(6) NOT NULL DEFAULT now(),
  "approved_at" timestamptz(6),
  "approved_by" int8,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of organizers
-- ----------------------------

-- ----------------------------
-- Table structure for payment_transactions
-- ----------------------------
DROP TABLE IF EXISTS "public"."payment_transactions";
CREATE TABLE "public"."payment_transactions" (
  "id" int8 NOT NULL DEFAULT nextval('payment_transactions_id_seq'::regclass),
  "order_id" int8 NOT NULL,
  "provider" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'vnpay'::text,
  "provider_txn_id" text COLLATE "pg_catalog"."default",
  "provider_txn_ref" text COLLATE "pg_catalog"."default",
  "amount_cents" int8 NOT NULL,
  "status" text COLLATE "pg_catalog"."default" NOT NULL,
  "raw_payload" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of payment_transactions
-- ----------------------------

-- ----------------------------
-- Table structure for refund_requests
-- ----------------------------
DROP TABLE IF EXISTS "public"."refund_requests";
CREATE TABLE "public"."refund_requests" (
  "id" int8 NOT NULL DEFAULT nextval('refund_requests_id_seq'::regclass),
  "order_id" int8 NOT NULL,
  "requested_by" int8 NOT NULL,
  "reason" text COLLATE "pg_catalog"."default" NOT NULL,
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'pending'::text,
  "refund_amount_cents" int8,
  "resolved_by" int8,
  "resolved_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of refund_requests
-- ----------------------------

-- ----------------------------
-- Table structure for reservation_items
-- ----------------------------
DROP TABLE IF EXISTS "public"."reservation_items";
CREATE TABLE "public"."reservation_items" (
  "id" int8 NOT NULL DEFAULT nextval('reservation_items_id_seq'::regclass),
  "reservation_id" int8 NOT NULL,
  "ticket_tier_id" int8 NOT NULL,
  "showtime_seat_id" int8,
  "quantity" int4 NOT NULL DEFAULT 1,
  "unit_price_cents" int8 NOT NULL
)
;

-- ----------------------------
-- Records of reservation_items
-- ----------------------------

-- ----------------------------
-- Table structure for reservations
-- ----------------------------
DROP TABLE IF EXISTS "public"."reservations";
CREATE TABLE "public"."reservations" (
  "id" int8 NOT NULL DEFAULT nextval('reservations_id_seq'::regclass),
  "user_id" int8,
  "showtime_id" int8 NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "status" text COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of reservations
-- ----------------------------

-- ----------------------------
-- Table structure for reviews
-- ----------------------------
DROP TABLE IF EXISTS "public"."reviews";
CREATE TABLE "public"."reviews" (
  "id" int8 NOT NULL DEFAULT nextval('reviews_id_seq'::regclass),
  "user_id" int8 NOT NULL,
  "event_id" int8 NOT NULL,
  "ticket_id" int8 NOT NULL,
  "rating" int2 NOT NULL,
  "comment" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of reviews
-- ----------------------------

-- ----------------------------
-- Table structure for saved_events
-- ----------------------------
DROP TABLE IF EXISTS "public"."saved_events";
CREATE TABLE "public"."saved_events" (
  "user_id" int8 NOT NULL,
  "event_id" int8 NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of saved_events
-- ----------------------------

-- ----------------------------
-- Table structure for seats
-- ----------------------------
DROP TABLE IF EXISTS "public"."seats";
CREATE TABLE "public"."seats" (
  "id" int8 NOT NULL DEFAULT nextval('seats_id_seq'::regclass),
  "venue_id" int8 NOT NULL,
  "section_id" int8,
  "row_label" text COLLATE "pg_catalog"."default" NOT NULL,
  "seat_number" int4 NOT NULL,
  "seat_type" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'single'::text
)
;

-- ----------------------------
-- Records of seats
-- ----------------------------

-- ----------------------------
-- Table structure for sections
-- ----------------------------
DROP TABLE IF EXISTS "public"."sections";
CREATE TABLE "public"."sections" (
  "id" int8 NOT NULL DEFAULT nextval('sections_id_seq'::regclass),
  "venue_id" int8 NOT NULL,
  "name" text COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default"
)
;

-- ----------------------------
-- Records of sections
-- ----------------------------

-- ----------------------------
-- Table structure for showtime_seats
-- ----------------------------
DROP TABLE IF EXISTS "public"."showtime_seats";
CREATE TABLE "public"."showtime_seats" (
  "id" int8 NOT NULL DEFAULT nextval('showtime_seats_id_seq'::regclass),
  "showtime_id" int8 NOT NULL,
  "seat_id" int8 NOT NULL,
  "ticket_tier_id" int8 NOT NULL,
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'available'::text,
  "hold_owner_id" int8,
  "hold_token" text COLLATE "pg_catalog"."default",
  "hold_expires_at" timestamptz(6)
)
;

-- ----------------------------
-- Records of showtime_seats
-- ----------------------------

-- ----------------------------
-- Table structure for showtimes
-- ----------------------------
DROP TABLE IF EXISTS "public"."showtimes";
CREATE TABLE "public"."showtimes" (
  "id" int8 NOT NULL DEFAULT nextval('showtimes_id_seq'::regclass),
  "event_id" int8 NOT NULL,
  "venue_id" int8,
  "starts_at" timestamptz(6) NOT NULL,
  "ends_at" timestamptz(6),
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'scheduled'::text
)
;

-- ----------------------------
-- Records of showtimes
-- ----------------------------

-- ----------------------------
-- Table structure for ticket_tiers
-- ----------------------------
DROP TABLE IF EXISTS "public"."ticket_tiers";
CREATE TABLE "public"."ticket_tiers" (
  "id" int8 NOT NULL DEFAULT nextval('ticket_tiers_id_seq'::regclass),
  "showtime_id" int8 NOT NULL,
  "label" text COLLATE "pg_catalog"."default" NOT NULL,
  "price_cents" int8 NOT NULL,
  "currency" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'VND'::text,
  "description" text COLLATE "pg_catalog"."default",
  "badge" text COLLATE "pg_catalog"."default",
  "total_quantity" int4,
  "sold_quantity" int4 NOT NULL DEFAULT 0,
  "reserved_quantity" int4 NOT NULL DEFAULT 0
)
;

-- ----------------------------
-- Records of ticket_tiers
-- ----------------------------

-- ----------------------------
-- Table structure for tickets
-- ----------------------------
DROP TABLE IF EXISTS "public"."tickets";
CREATE TABLE "public"."tickets" (
  "id" int8 NOT NULL DEFAULT nextval('tickets_id_seq'::regclass),
  "order_id" int8 NOT NULL,
  "reservation_item_id" int8 NOT NULL,
  "price_cents" int8 NOT NULL,
  "qr_token_hash" text COLLATE "pg_catalog"."default" NOT NULL,
  "barcode_value" text COLLATE "pg_catalog"."default" NOT NULL,
  "qr_status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'unused'::text,
  "checked_in_at" timestamptz(6),
  "checked_in_by" int8,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of tickets
-- ----------------------------

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS "public"."users";
CREATE TABLE "public"."users" (
  "id" int8 NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  "email" text COLLATE "pg_catalog"."default" NOT NULL,
  "phone" text COLLATE "pg_catalog"."default",
  "full_name" text COLLATE "pg_catalog"."default",
  "password_hash" text COLLATE "pg_catalog"."default",
  "provider" text COLLATE "pg_catalog"."default",
  "provider_user_id" text COLLATE "pg_catalog"."default",
  "role" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'attendee'::text,
  "avatar_url" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of users
-- ----------------------------

-- ----------------------------
-- Table structure for venues
-- ----------------------------
DROP TABLE IF EXISTS "public"."venues";
CREATE TABLE "public"."venues" (
  "id" int8 NOT NULL DEFAULT nextval('venues_id_seq'::regclass),
  "name" text COLLATE "pg_catalog"."default" NOT NULL,
  "city" text COLLATE "pg_catalog"."default" NOT NULL,
  "raw_address" text COLLATE "pg_catalog"."default" NOT NULL,
  "address_line" text COLLATE "pg_catalog"."default",
  "map_url" text COLLATE "pg_catalog"."default",
  "guide" text COLLATE "pg_catalog"."default",
  "normalized_name" text COLLATE "pg_catalog"."default" GENERATED ALWAYS AS (
lower(regexp_replace(name, '\s+'::text, ' '::text, 'g'::text))
) STORED,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Records of venues
-- ----------------------------

-- ----------------------------
-- Table structure for vouchers
-- ----------------------------
DROP TABLE IF EXISTS "public"."vouchers";
CREATE TABLE "public"."vouchers" (
  "id" int8 NOT NULL DEFAULT nextval('vouchers_id_seq'::regclass),
  "code" text COLLATE "pg_catalog"."default" NOT NULL,
  "discount_type" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'fixed'::text,
  "discount_amount_cents" int8 NOT NULL,
  "discount_percent" numeric(5,2),
  "min_order_cents" int8 NOT NULL DEFAULT 0,
  "usage_limit" int4,
  "usage_limit_per_user" int4 DEFAULT 1,
  "used_count" int4 NOT NULL DEFAULT 0,
  "expires_at" timestamptz(6),
  "active" bool NOT NULL DEFAULT true
)
;

-- ----------------------------
-- Records of vouchers
-- ----------------------------

-- ----------------------------
-- Table structure for waitlists
-- ----------------------------
DROP TABLE IF EXISTS "public"."waitlists";
CREATE TABLE "public"."waitlists" (
  "id" int8 NOT NULL DEFAULT nextval('waitlists_id_seq'::regclass),
  "user_id" int8 NOT NULL,
  "showtime_id" int8 NOT NULL,
  "ticket_tier_id" int8,
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'waiting'::text,
  "joined_at" timestamptz(6) NOT NULL DEFAULT now(),
  "notified_at" timestamptz(6)
)
;

-- ----------------------------
-- Records of waitlists
-- ----------------------------

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."event_categories_id_seq"
OWNED BY "public"."event_categories"."id";
SELECT setval('"public"."event_categories_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."event_views_id_seq"
OWNED BY "public"."event_views"."id";
SELECT setval('"public"."event_views_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."events_id_seq"
OWNED BY "public"."events"."id";
SELECT setval('"public"."events_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."notifications_id_seq"
OWNED BY "public"."notifications"."id";
SELECT setval('"public"."notifications_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."orders_id_seq"
OWNED BY "public"."orders"."id";
SELECT setval('"public"."orders_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."organizers_id_seq"
OWNED BY "public"."organizers"."id";
SELECT setval('"public"."organizers_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."payment_transactions_id_seq"
OWNED BY "public"."payment_transactions"."id";
SELECT setval('"public"."payment_transactions_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."refund_requests_id_seq"
OWNED BY "public"."refund_requests"."id";
SELECT setval('"public"."refund_requests_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."reservation_items_id_seq"
OWNED BY "public"."reservation_items"."id";
SELECT setval('"public"."reservation_items_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."reservations_id_seq"
OWNED BY "public"."reservations"."id";
SELECT setval('"public"."reservations_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."reviews_id_seq"
OWNED BY "public"."reviews"."id";
SELECT setval('"public"."reviews_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."seats_id_seq"
OWNED BY "public"."seats"."id";
SELECT setval('"public"."seats_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."sections_id_seq"
OWNED BY "public"."sections"."id";
SELECT setval('"public"."sections_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."showtime_seats_id_seq"
OWNED BY "public"."showtime_seats"."id";
SELECT setval('"public"."showtime_seats_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."showtimes_id_seq"
OWNED BY "public"."showtimes"."id";
SELECT setval('"public"."showtimes_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."ticket_tiers_id_seq"
OWNED BY "public"."ticket_tiers"."id";
SELECT setval('"public"."ticket_tiers_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."tickets_id_seq"
OWNED BY "public"."tickets"."id";
SELECT setval('"public"."tickets_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."users_id_seq"
OWNED BY "public"."users"."id";
SELECT setval('"public"."users_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."venues_id_seq"
OWNED BY "public"."venues"."id";
SELECT setval('"public"."venues_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."vouchers_id_seq"
OWNED BY "public"."vouchers"."id";
SELECT setval('"public"."vouchers_id_seq"', 1, false);

-- ----------------------------
-- Alter sequences owned by
-- ----------------------------
ALTER SEQUENCE "public"."waitlists_id_seq"
OWNED BY "public"."waitlists"."id";
SELECT setval('"public"."waitlists_id_seq"', 1, false);

-- ----------------------------
-- Uniques structure for table event_categories
-- ----------------------------
ALTER TABLE "public"."event_categories" ADD CONSTRAINT "event_categories_code_key" UNIQUE ("code");

-- ----------------------------
-- Primary Key structure for table event_categories
-- ----------------------------
ALTER TABLE "public"."event_categories" ADD CONSTRAINT "event_categories_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table event_views
-- ----------------------------
CREATE INDEX "idx_event_views_user" ON "public"."event_views" USING btree (
  "user_id" "pg_catalog"."int8_ops" ASC NULLS LAST,
  "viewed_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);

-- ----------------------------
-- Primary Key structure for table event_views
-- ----------------------------
ALTER TABLE "public"."event_views" ADD CONSTRAINT "event_views_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table events
-- ----------------------------
CREATE INDEX "idx_events_category" ON "public"."events" USING btree (
  "category_id" "pg_catalog"."int2_ops" ASC NULLS LAST
);
CREATE INDEX "idx_events_moderation" ON "public"."events" USING btree (
  "moderation_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_events_organizer" ON "public"."events" USING btree (
  "organizer_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);
CREATE INDEX "idx_events_status" ON "public"."events" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table events
-- ----------------------------
ALTER TABLE "public"."events" ADD CONSTRAINT "events_slug_key" UNIQUE ("slug");

-- ----------------------------
-- Checks structure for table events
-- ----------------------------
ALTER TABLE "public"."events" ADD CONSTRAINT "events_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'on_sale'::text, 'out_of_ticket'::text, 'finished'::text, 'cancelled'::text]));
ALTER TABLE "public"."events" ADD CONSTRAINT "events_moderation_status_check" CHECK (moderation_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'flagged'::text, 'removed'::text]));
ALTER TABLE "public"."events" ADD CONSTRAINT "events_check" CHECK (location_type = 'online'::text OR online_url IS NULL);
ALTER TABLE "public"."events" ADD CONSTRAINT "events_location_type_check" CHECK (location_type = ANY (ARRAY['physical'::text, 'online'::text]));
ALTER TABLE "public"."events" ADD CONSTRAINT "events_event_type_check" CHECK (event_type = ANY (ARRAY['general_admission'::text, 'seated'::text]));

-- ----------------------------
-- Primary Key structure for table events
-- ----------------------------
ALTER TABLE "public"."events" ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table notifications
-- ----------------------------
CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING btree (
  "user_id" "pg_catalog"."int8_ops" ASC NULLS LAST,
  "read_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table notifications
-- ----------------------------
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_channel_check" CHECK (channel = ANY (ARRAY['in_app'::text, 'email'::text]));

-- ----------------------------
-- Primary Key structure for table notifications
-- ----------------------------
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table orders
-- ----------------------------
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_order_code_key" UNIQUE ("order_code");

-- ----------------------------
-- Checks structure for table orders
-- ----------------------------
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_payment_status_check" CHECK (payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text, 'cancelled'::text]));

-- ----------------------------
-- Primary Key structure for table orders
-- ----------------------------
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table organizers
-- ----------------------------
CREATE INDEX "idx_organizers_status" ON "public"."organizers" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table organizers
-- ----------------------------
ALTER TABLE "public"."organizers" ADD CONSTRAINT "organizers_user_id_key" UNIQUE ("user_id");

-- ----------------------------
-- Checks structure for table organizers
-- ----------------------------
ALTER TABLE "public"."organizers" ADD CONSTRAINT "organizers_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text]));

-- ----------------------------
-- Primary Key structure for table organizers
-- ----------------------------
ALTER TABLE "public"."organizers" ADD CONSTRAINT "organizers_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table payment_transactions
-- ----------------------------
CREATE INDEX "idx_payment_txn_order" ON "public"."payment_transactions" USING btree (
  "order_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table payment_transactions
-- ----------------------------
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_provider_provider_txn_ref_key" UNIQUE ("provider", "provider_txn_ref");

-- ----------------------------
-- Checks structure for table payment_transactions
-- ----------------------------
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_status_check" CHECK (status = ANY (ARRAY['initiated'::text, 'success'::text, 'failed'::text, 'refunded'::text]));

-- ----------------------------
-- Primary Key structure for table payment_transactions
-- ----------------------------
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table refund_requests
-- ----------------------------
CREATE INDEX "idx_refund_requests_status" ON "public"."refund_requests" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table refund_requests
-- ----------------------------
ALTER TABLE "public"."refund_requests" ADD CONSTRAINT "refund_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'escalated'::text, 'completed'::text]));

-- ----------------------------
-- Primary Key structure for table refund_requests
-- ----------------------------
ALTER TABLE "public"."refund_requests" ADD CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table reservation_items
-- ----------------------------
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_showtime_seat_id_key" UNIQUE ("reservation_id", "showtime_seat_id");

-- ----------------------------
-- Checks structure for table reservation_items
-- ----------------------------
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_quantity_check" CHECK (quantity > 0);

-- ----------------------------
-- Primary Key structure for table reservation_items
-- ----------------------------
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table reservations
-- ----------------------------
CREATE INDEX "idx_reservations_expiry" ON "public"."reservations" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST,
  "expires_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table reservations
-- ----------------------------
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_status_check" CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'converted'::text, 'cancelled'::text]));

-- ----------------------------
-- Primary Key structure for table reservations
-- ----------------------------
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table reviews
-- ----------------------------
CREATE INDEX "idx_reviews_event" ON "public"."reviews" USING btree (
  "event_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table reviews
-- ----------------------------
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_ticket_id_key" UNIQUE ("ticket_id");

-- ----------------------------
-- Checks structure for table reviews
-- ----------------------------
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_rating_check" CHECK (rating >= 1 AND rating <= 5);

-- ----------------------------
-- Primary Key structure for table reviews
-- ----------------------------
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Primary Key structure for table saved_events
-- ----------------------------
ALTER TABLE "public"."saved_events" ADD CONSTRAINT "saved_events_pkey" PRIMARY KEY ("user_id", "event_id");

-- ----------------------------
-- Uniques structure for table seats
-- ----------------------------
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_venue_id_row_label_seat_number_key" UNIQUE ("venue_id", "row_label", "seat_number");

-- ----------------------------
-- Checks structure for table seats
-- ----------------------------
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_seat_type_check" CHECK (seat_type = ANY (ARRAY['single'::text, 'double'::text, 'standing'::text]));

-- ----------------------------
-- Primary Key structure for table seats
-- ----------------------------
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table sections
-- ----------------------------
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_venue_id_name_key" UNIQUE ("venue_id", "name");

-- ----------------------------
-- Primary Key structure for table sections
-- ----------------------------
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table showtime_seats
-- ----------------------------
CREATE INDEX "idx_showtime_seats_hold_expiry" ON "public"."showtime_seats" USING btree (
  "hold_expires_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
) WHERE status = 'held'::text;
CREATE INDEX "idx_showtime_seats_showtime" ON "public"."showtime_seats" USING btree (
  "showtime_id" "pg_catalog"."int8_ops" ASC NULLS LAST,
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table showtime_seats
-- ----------------------------
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_showtime_id_seat_id_key" UNIQUE ("showtime_id", "seat_id");

-- ----------------------------
-- Checks structure for table showtime_seats
-- ----------------------------
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_status_check" CHECK (status = ANY (ARRAY['available'::text, 'held'::text, 'sold'::text, 'blocked'::text]));

-- ----------------------------
-- Primary Key structure for table showtime_seats
-- ----------------------------
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table showtimes
-- ----------------------------
CREATE INDEX "idx_showtimes_event" ON "public"."showtimes" USING btree (
  "event_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);
CREATE INDEX "idx_showtimes_starts_at" ON "public"."showtimes" USING btree (
  "starts_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table showtimes
-- ----------------------------
ALTER TABLE "public"."showtimes" ADD CONSTRAINT "showtimes_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'on_sale'::text, 'sold_out'::text, 'finished'::text, 'cancelled'::text]));

-- ----------------------------
-- Primary Key structure for table showtimes
-- ----------------------------
ALTER TABLE "public"."showtimes" ADD CONSTRAINT "showtimes_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table ticket_tiers
-- ----------------------------
CREATE INDEX "idx_ticket_tiers_showtime" ON "public"."ticket_tiers" USING btree (
  "showtime_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table ticket_tiers
-- ----------------------------
ALTER TABLE "public"."ticket_tiers" ADD CONSTRAINT "ticket_tiers_check" CHECK ((sold_quantity + reserved_quantity) <= COALESCE(total_quantity, sold_quantity + reserved_quantity));

-- ----------------------------
-- Primary Key structure for table ticket_tiers
-- ----------------------------
ALTER TABLE "public"."ticket_tiers" ADD CONSTRAINT "ticket_tiers_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table tickets
-- ----------------------------
CREATE INDEX "idx_tickets_order" ON "public"."tickets" USING btree (
  "order_id" "pg_catalog"."int8_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table tickets
-- ----------------------------
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_qr_token_hash_key" UNIQUE ("qr_token_hash");
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_barcode_value_key" UNIQUE ("barcode_value");

-- ----------------------------
-- Checks structure for table tickets
-- ----------------------------
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_qr_status_check" CHECK (qr_status = ANY (ARRAY['unused'::text, 'checked_in'::text, 'void'::text]));

-- ----------------------------
-- Primary Key structure for table tickets
-- ----------------------------
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");

-- ----------------------------
-- Checks structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['attendee'::text, 'organizer'::text, 'admin'::text]));

-- ----------------------------
-- Primary Key structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table venues
-- ----------------------------
ALTER TABLE "public"."venues" ADD CONSTRAINT "venues_normalized_name_city_key" UNIQUE ("normalized_name", "city");

-- ----------------------------
-- Primary Key structure for table venues
-- ----------------------------
ALTER TABLE "public"."venues" ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table vouchers
-- ----------------------------
ALTER TABLE "public"."vouchers" ADD CONSTRAINT "vouchers_code_key" UNIQUE ("code");

-- ----------------------------
-- Checks structure for table vouchers
-- ----------------------------
ALTER TABLE "public"."vouchers" ADD CONSTRAINT "vouchers_discount_type_check" CHECK (discount_type = ANY (ARRAY['fixed'::text, 'percent'::text]));

-- ----------------------------
-- Primary Key structure for table vouchers
-- ----------------------------
ALTER TABLE "public"."vouchers" ADD CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Uniques structure for table waitlists
-- ----------------------------
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_user_id_showtime_id_ticket_tier_id_key" UNIQUE ("user_id", "showtime_id", "ticket_tier_id");

-- ----------------------------
-- Checks structure for table waitlists
-- ----------------------------
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_status_check" CHECK (status = ANY (ARRAY['waiting'::text, 'notified'::text, 'expired'::text, 'converted'::text]));

-- ----------------------------
-- Primary Key structure for table waitlists
-- ----------------------------
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Foreign Keys structure for table event_views
-- ----------------------------
ALTER TABLE "public"."event_views" ADD CONSTRAINT "event_views_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."event_views" ADD CONSTRAINT "event_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table events
-- ----------------------------
ALTER TABLE "public"."events" ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table notifications
-- ----------------------------
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table orders
-- ----------------------------
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table organizers
-- ----------------------------
ALTER TABLE "public"."organizers" ADD CONSTRAINT "organizers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."organizers" ADD CONSTRAINT "organizers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table payment_transactions
-- ----------------------------
ALTER TABLE "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table refund_requests
-- ----------------------------
ALTER TABLE "public"."refund_requests" ADD CONSTRAINT "refund_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."refund_requests" ADD CONSTRAINT "refund_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."refund_requests" ADD CONSTRAINT "refund_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table reservation_items
-- ----------------------------
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_showtime_seat_id_fkey" FOREIGN KEY ("showtime_seat_id") REFERENCES "public"."showtime_seats" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."reservation_items" ADD CONSTRAINT "reservation_items_ticket_tier_id_fkey" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."ticket_tiers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table reservations
-- ----------------------------
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table reviews
-- ----------------------------
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table saved_events
-- ----------------------------
ALTER TABLE "public"."saved_events" ADD CONSTRAINT "saved_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."saved_events" ADD CONSTRAINT "saved_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table seats
-- ----------------------------
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."sections" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."seats" ADD CONSTRAINT "seats_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table sections
-- ----------------------------
ALTER TABLE "public"."sections" ADD CONSTRAINT "sections_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table showtime_seats
-- ----------------------------
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_hold_owner_id_fkey" FOREIGN KEY ("hold_owner_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "public"."seats" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."showtime_seats" ADD CONSTRAINT "showtime_seats_ticket_tier_id_fkey" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."ticket_tiers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table showtimes
-- ----------------------------
ALTER TABLE "public"."showtimes" ADD CONSTRAINT "showtimes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."showtimes" ADD CONSTRAINT "showtimes_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table ticket_tiers
-- ----------------------------
ALTER TABLE "public"."ticket_tiers" ADD CONSTRAINT "ticket_tiers_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table tickets
-- ----------------------------
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."tickets" ADD CONSTRAINT "tickets_reservation_item_id_fkey" FOREIGN KEY ("reservation_item_id") REFERENCES "public"."reservation_items" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table waitlists
-- ----------------------------
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_showtime_id_fkey" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_ticket_tier_id_fkey" FOREIGN KEY ("ticket_tier_id") REFERENCES "public"."ticket_tiers" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."waitlists" ADD CONSTRAINT "waitlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ----------------------------
-- Wallet checkout extension (UC-02)
-- Reuses orders, tickets, payment_transactions, reservations and reservation_items above.
-- ----------------------------
CREATE TABLE "public"."wallets" (
  "id" int8 GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "user_id" int8 NOT NULL UNIQUE REFERENCES "public"."users" ("id"),
  "balance_amount" int8 NOT NULL DEFAULT 0 CHECK ("balance_amount" >= 0),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);
INSERT INTO "public"."wallets" ("user_id", "balance_amount")
SELECT "id", 0 FROM "public"."users"
ON CONFLICT ("user_id") DO NOTHING;

ALTER TABLE "public"."payment_transactions" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "public"."payment_transactions" ADD COLUMN "user_id" int8 REFERENCES "public"."users" ("id");
ALTER TABLE "public"."payment_transactions" ADD COLUMN "payment_kind" text NOT NULL DEFAULT 'order'
  CHECK ("payment_kind" IN ('topup', 'order'));
ALTER TABLE "public"."payment_transactions" ADD COLUMN "updated_at" timestamptz(6) NOT NULL DEFAULT now();
CREATE INDEX "idx_payment_transactions_user_created" ON "public"."payment_transactions" ("user_id", "created_at" DESC);

CREATE TABLE "public"."wallet_transactions" (
  "id" int8 GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "wallet_id" int8 NOT NULL REFERENCES "public"."wallets" ("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('topup', 'purchase', 'refund')),
  "amount" int8 NOT NULL CHECK ("amount" <> 0),
  "balance_after" int8 NOT NULL CHECK ("balance_after" >= 0),
  "payment_transaction_id" int8 UNIQUE REFERENCES "public"."payment_transactions" ("id"),
  "order_id" int8 REFERENCES "public"."orders" ("id"),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CHECK (("kind" = 'topup' AND "amount" > 0 AND "payment_transaction_id" IS NOT NULL AND "order_id" IS NULL)
      OR ("kind" = 'purchase' AND "amount" < 0 AND "order_id" IS NOT NULL)
      OR ("kind" = 'refund' AND "amount" > 0 AND "order_id" IS NOT NULL))
);
CREATE INDEX "idx_wallet_transactions_wallet_created" ON "public"."wallet_transactions" ("wallet_id", "created_at" DESC);
CREATE UNIQUE INDEX "wallet_purchase_once" ON "public"."wallet_transactions" ("order_id") WHERE "kind" = 'purchase';
CREATE UNIQUE INDEX "orders_reservation_once" ON "public"."orders" ("reservation_id");
