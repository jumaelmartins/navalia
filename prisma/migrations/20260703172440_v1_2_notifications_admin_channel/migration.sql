-- AlterTable
ALTER TABLE "Barbershop" ADD COLUMN     "adminPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "adminPinExpiresAt" TIMESTAMP(3),
ADD COLUMN     "adminPinHash" TEXT,
ADD COLUMN     "notifyOwnerWhatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerNotifyPhone" TEXT;

-- AlterTable
ALTER TABLE "WhatsappConversation" ADD COLUMN     "pendingActionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pendingActionId" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "appointmentId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_barbershopId_readAt_idx" ON "Notification"("barbershopId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_barbershopId_createdAt_idx" ON "Notification"("barbershopId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
