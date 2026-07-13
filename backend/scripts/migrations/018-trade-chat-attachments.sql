ALTER TABLE trade_messages
  ALTER COLUMN body DROP NOT NULL;

ALTER TABLE trade_messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT;

ALTER TABLE trade_messages DROP CONSTRAINT IF EXISTS trade_messages_body_check;
ALTER TABLE trade_messages DROP CONSTRAINT IF EXISTS trade_messages_content_check;
ALTER TABLE trade_messages ADD CONSTRAINT trade_messages_content_check CHECK (
  (body IS NOT NULL AND char_length(body) BETWEEN 1 AND 1000)
  OR attachment_url IS NOT NULL
);
