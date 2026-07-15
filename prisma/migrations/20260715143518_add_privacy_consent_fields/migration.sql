-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "privacyConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsappConversation" ADD COLUMN     "privacyNoticeSentAt" TIMESTAMP(3);
