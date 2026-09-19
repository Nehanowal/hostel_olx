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

CREATE TABLE IF NOT EXISTS listing_opens (
 listing_id TEXT NOT NULL REFERENCES listings(id), viewer_id TEXT NOT NULL REFERENCES users(id),
 day TEXT NOT NULL, PRIMARY KEY(listing_id,viewer_id,day)
);
CREATE TABLE IF NOT EXISTS message_email_outbox (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
 recipient_id TEXT NOT NULL REFERENCES users(id), message_id INTEGER UNIQUE NOT NULL REFERENCES messages(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','skipped','failed')),
 created_at INTEGER NOT NULL, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER, lease_until INTEGER, lease_token TEXT, sent_at INTEGER,
 payload TEXT, last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_email_active ON message_email_outbox(conversation_id,recipient_id) WHERE status IN ('pending','sending');
CREATE INDEX IF NOT EXISTS idx_message_email_due ON message_email_outbox(status,due_at);

CREATE TABLE IF NOT EXISTS platform_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO platform_metadata VALUES ('tracking_since',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS user_visits (
 user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, last_seen INTEGER NOT NULL,
 PRIMARY KEY(user_id,day)
);
CREATE INDEX IF NOT EXISTS idx_visits_recent ON user_visits(last_seen);
CREATE TABLE IF NOT EXISTS platform_activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),
 listing_id TEXT REFERENCES listings(id),action TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS activity_signup AFTER INSERT ON users BEGIN
 INSERT INTO platform_activity(user_id,action) VALUES (NEW.id,'Joined');
END;
CREATE TRIGGER IF NOT EXISTS activity_listing_create AFTER INSERT ON listings WHEN NEW.is_demo=0 BEGIN
 INSERT INTO platform_activity(user_id,listing_id,action,title) VALUES (NEW.seller_id,NEW.id,'Listed',NEW.title);
END;
CREATE TRIGGER IF NOT EXISTS activity_listing_update AFTER UPDATE ON listings WHEN NEW.is_demo=0 AND (NEW.status<>OLD.status OR NEW.version<>OLD.version) BEGIN
 INSERT INTO platform_activity(user_id,listing_id,action,title) VALUES (NEW.seller_id,NEW.id,CASE WHEN NEW.status<>OLD.status THEN CASE NEW.status WHEN 'sold' THEN 'Marked sold' WHEN 'deleted' THEN 'Deleted' WHEN 'removed' THEN 'Removed by admin' WHEN 'unavailable' THEN 'Marked unavailable' ELSE 'Made available' END ELSE 'Edited' END,NEW.title);
END;
CREATE TRIGGER IF NOT EXISTS activity_login AFTER INSERT ON sessions BEGIN
 INSERT INTO platform_activity(user_id,action) VALUES (NEW.user_id,'Signed in');
END;
CREATE TRIGGER IF NOT EXISTS activity_user_status AFTER UPDATE OF status ON users WHEN NEW.status<>OLD.status BEGIN
 INSERT INTO platform_activity(user_id,action) VALUES (NEW.id,CASE NEW.status WHEN 'suspended' THEN 'Suspended by admin' ELSE 'Account reactivated' END);
END;
