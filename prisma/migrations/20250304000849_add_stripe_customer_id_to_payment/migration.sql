-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "stripeCustomerId" TEXT;
