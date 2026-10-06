-- Keep WhatsApp and Instagram as first-class contact channels without changing
-- the existing PHONE points used by telephony and WhatsApp integrations.
SET search_path TO crm, public;

ALTER TYPE "ContactPointType" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "ContactPointType" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
