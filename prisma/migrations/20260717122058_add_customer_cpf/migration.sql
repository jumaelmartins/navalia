-- DropIndex
DROP INDEX "Customer_barbershopId_phone_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "cpf" TEXT;

-- CreateIndex
CREATE INDEX "Customer_barbershopId_phone_idx" ON "Customer"("barbershopId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_barbershopId_cpf_key" ON "Customer"("barbershopId", "cpf");

