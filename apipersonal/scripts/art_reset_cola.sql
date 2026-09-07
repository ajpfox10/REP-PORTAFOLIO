-- Reset de art_alta_queue: reprocesar las que fallaron con el script viejo
-- (bug s1.sector_id, corregido) + destrabar locks abandonados.
-- No toca las DONE. Deja al worker de pm2 tomarlas en el siguiente poll.
UPDATE art_alta_queue
   SET status     = 'PENDING',
       attempts   = 0,
       locked_at  = NULL,
       started_at = NULL,
       last_error = NULL
 WHERE status = 'ERROR'
    OR (status = 'PROCESSING'
        AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)));

SELECT status, COUNT(*) AS cant FROM art_alta_queue GROUP BY status;
