CREATE TABLE IF NOT EXISTS notifications_dismissed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key varchar(255) NOT NULL,
  dismissed_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, notification_key)
);
CREATE INDEX IF NOT EXISTS notifications_dismissed_user_id_idx ON notifications_dismissed(user_id);
