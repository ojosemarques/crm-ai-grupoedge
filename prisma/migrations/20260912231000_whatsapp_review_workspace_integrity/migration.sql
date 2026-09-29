ALTER TABLE "whatsapp_event_reviews"
  ADD COLUMN "conversationId" UUID;

CREATE INDEX "whatsapp_event_reviews_workspaceId_conversationId_createdAt_idx"
  ON "whatsapp_event_reviews"("workspaceId", "conversationId", "createdAt");

ALTER TABLE "whatsapp_event_reviews"
  ADD CONSTRAINT "whatsapp_reviews_conversation_fkey"
  FOREIGN KEY ("workspaceId", "conversationId")
  REFERENCES "conversations"("workspaceId", "id")
  ON DELETE RESTRICT;
