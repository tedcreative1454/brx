ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_type_check;

ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_type_check
  CHECK (type IN ('telebirr', 'mpesa', 'cbe_birr', 'airtel_money', 'bank', 'other'));
