-- Migration 044: concurrency-safe invoice numbering per branch.

CREATE TABLE IF NOT EXISTS invoice_branch_sequences (
  branch_id INT UNSIGNED NOT NULL PRIMARY KEY,
  next_seq BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO invoice_branch_sequences (branch_id, next_seq)
SELECT b.id, COALESCE(MAX(i.id), 0)
FROM branches b
LEFT JOIN invoices i ON i.branch_id = b.id
GROUP BY b.id
ON DUPLICATE KEY UPDATE
  next_seq = GREATEST(invoice_branch_sequences.next_seq, VALUES(next_seq));
