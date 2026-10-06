-- Keep WhatsApp and Instagram as first-class contact channels without changing
-- the existing PHONE points used by telephony and WhatsApp integrations.
ALTER TYPE "ContactPointType" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "ContactPointType" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
