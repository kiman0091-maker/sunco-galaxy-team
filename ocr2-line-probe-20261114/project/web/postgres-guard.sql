-- R7 candidate schema. Execute only in a separately approved empty PostgreSQL DB.
-- Application role must not own schema or change control/epoch/DDL.
BEGIN;
CREATE SCHEMA sunco_guard;
CREATE TABLE sunco_guard.control (
 singleton integer PRIMARY KEY CHECK (singleton=1),
 storage_id text NOT NULL, store_uuid text NOT NULL, epoch text NOT NULL, enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE sunco_guard.requests (
 business text PRIMARY KEY, account text NOT NULL, payload text NOT NULL,
 owner text NOT NULL UNIQUE, epoch text NOT NULL,
 state text NOT NULL CHECK (state IN ('pending','answered','unknown')),
 created_ms bigint NOT NULL
);
CREATE TABLE sunco_guard.accounts (
 account text PRIMARY KEY, owner text NOT NULL UNIQUE REFERENCES sunco_guard.requests(owner)
);
CREATE TABLE sunco_guard.resources (
 resource text PRIMARY KEY, business text NOT NULL REFERENCES sunco_guard.requests(business)
);
CREATE TABLE sunco_guard.aliases (
 alias text PRIMARY KEY, business text NOT NULL, payload text NOT NULL
);
COMMIT;
-- No enabled row inserted automatically. Separate reconciliation + approval required.
