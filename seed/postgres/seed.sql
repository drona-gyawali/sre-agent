INSERT INTO customers (customer_id, email, plan, created_at)
VALUES
  ('C-1001', 'customer@example.com', 'pro', now() - interval '30 days'),
  ('C-1002', 'other@example.com', 'free', now() - interval '14 days')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO orders (customer_id, transaction_id, status, amount, error_code, created_at)
VALUES
  ('C-1001', 'TXN-9988', 'failed', 299.99, 'card_declined', now() - interval '35 minutes'),
  ('C-1001', 'TXN-9989', 'failed', 299.99, 'card_declined', now() - interval '33 minutes'),
  ('C-1001', 'TXN-9990', 'success', 299.99, NULL, now() - interval '3 hours'),
  ('C-1002', 'TXN-9991', 'success', 49.50, NULL, now() - interval '2 hours')
ON CONFLICT (transaction_id) DO NOTHING;

DELETE FROM payment_attempts WHERE transaction_id IN ('TXN-9988', 'TXN-9989', 'TXN-9990', 'TXN-9991');

INSERT INTO payment_attempts (transaction_id, customer_id, provider, status, error_code, latency_ms, created_at)
VALUES
  ('TXN-9988', 'C-1001', 'stripe', 'failed', 'card_declined', 1450, now() - interval '35 minutes'),
  ('TXN-9988', 'C-1001', 'stripe', 'failed', 'card_declined', 1620, now() - interval '34 minutes'),
  ('TXN-9989', 'C-1001', 'stripe', 'failed', 'card_declined', 1510, now() - interval '33 minutes'),
  ('TXN-9990', 'C-1001', 'stripe', 'success', NULL, 320, now() - interval '3 hours'),
  ('TXN-9991', 'C-1002', 'stripe', 'success', NULL, 280, now() - interval '2 hours');
