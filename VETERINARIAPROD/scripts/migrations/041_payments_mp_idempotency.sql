-- Migration 041: enforce MercadoPago webhook idempotency at database level.

ALTER TABLE payments
  ADD UNIQUE KEY uq_payments_mp_payment_id (mp_payment_id);
