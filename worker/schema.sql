-- PodCheck D1 schema, exported from the live database Sep 8 2026

CREATE TABLE api_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, route TEXT NOT NULL, status INTEGER, ms INTEGER, ip_hash TEXT, note TEXT);

CREATE TABLE license_cache (q TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, result_json TEXT NOT NULL);

CREATE TABLE outcomes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, band TEXT NOT NULL, score INTEGER NOT NULL, factors_json TEXT NOT NULL, qr_class TEXT, dcc_status TEXT, channel TEXT, state TEXT DEFAULT 'CA', is_test INTEGER DEFAULT 0);

CREATE TABLE rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, window_start TEXT NOT NULL);

CREATE TABLE reports (id TEXT PRIMARY KEY, ts TEXT NOT NULL, band TEXT NOT NULL, score INTEGER NOT NULL, analysis_json TEXT NOT NULL, seller_json TEXT, contact_json TEXT, image_keys_json TEXT NOT NULL, narrative TEXT NOT NULL, channels_json TEXT, ip_hash TEXT, is_test INTEGER DEFAULT 0);

CREATE TABLE rid_cache(k TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, result_json TEXT NOT NULL);

CREATE TABLE scan_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, outcome TEXT NOT NULL, state TEXT, brand TEXT, product TEXT, package_label TEXT, is_recall INTEGER DEFAULT 0, host TEXT, ip_hash TEXT, match INTEGER, raw_text TEXT, via TEXT, is_test INTEGER DEFAULT 0);

CREATE INDEX idx_outcomes_ts ON outcomes(ts);
