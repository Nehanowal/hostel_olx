CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 university TEXT NOT NULL, campus TEXT NOT NULL DEFAULT 'Sonipat',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 verified_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS challenges (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL,
 auth_method TEXT NOT NULL DEFAULT 'local'
);
CREATE TABLE IF NOT EXISTS listings (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), university TEXT NOT NULL,
 title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price >= 0), condition TEXT NOT NULL,
 location TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','unavailable','removed','deleted')),
 version INTEGER NOT NULL DEFAULT 1, is_demo INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_scope ON listings(university,status,created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id,status);
CREATE TABLE IF NOT EXISTS images (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT REFERENCES listings(id),
 path TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON images(listing_id,position);
CREATE TABLE IF NOT EXISTS favorites (
 user_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT NOT NULL REFERENCES listings(id),
 PRIMARY KEY(user_id,listing_id)
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id),
 buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(listing_id,buyer_id), CHECK(buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_buyer ON conversations(buyer_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(seller_id,updated_at);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id),
 sender_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,id DESC);
CREATE TABLE IF NOT EXISTS conversation_reads (
 conversation_id TEXT NOT NULL REFERENCES conversations(id), user_id TEXT NOT NULL REFERENCES users(id),
 last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS blocks (
 blocker_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id),
 listing_id TEXT REFERENCES listings(id), conversation_id TEXT REFERENCES conversations(id),
 reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((listing_id IS NULL) <> (conversation_id IS NULL))
);
CREATE TABLE IF NOT EXISTS admin_actions (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), report_id TEXT REFERENCES reports(id),
 action TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS google_identities (
 subject TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS google_challenges (
 nonce_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_impressions (
 listing_id TEXT NOT NULL REFERENCES listings(id), viewer_id TEXT NOT NULL REFERENCES users(id),
 day TEXT NOT NULL, PRIMARY KEY(listing_id,viewer_id,day)
);
