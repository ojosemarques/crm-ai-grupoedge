-- Prisma upsert needs a non-partial conflict target. PostgreSQL still allows
-- multiple NULL receiptIds, while every real receipt remains unique by reason.
DROP INDEX "payment_issues_receipt_reason_key";
CREATE UNIQUE INDEX "payment_issues_receipt_reason_key" ON "payment_reconciliation_issues"("workspaceId","receiptId","reason");
