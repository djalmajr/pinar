-- F4d: the metered gate consumes the credit before it persists the result
-- (a result written to a session always has a consumed usage). When the
-- persistence fails afterwards — the 404 of a session deleted between the
-- read and the write, a failed write — the already-consumed usage is
-- refunded, so the ledger must credit the grant back for the
-- succeeded -> refunded transition too, not only for reserved -> refunded.
-- The refund trigger is rebuilt with the same guard (the grant still holds
-- the consumed credits, one credit at most once) accepting both origins;
-- the table, its rows, the indexes and the consume trigger are untouched.
DROP TRIGGER refund_ai_credit_usage;
CREATE TRIGGER refund_ai_credit_usage
AFTER UPDATE OF status ON ai_credit_usages
WHEN OLD.status IN ('reserved', 'succeeded') AND NEW.status = 'refunded'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits - OLD.credits
  WHERE id = OLD.grant_id
    AND consumed_credits >= OLD.credits;
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'ai_credit_refund_failed') END);
END;
