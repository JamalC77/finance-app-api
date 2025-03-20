-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "planType" "PlanType" NOT NULL DEFAULT 'FREE';
ALTER TABLE "users" ADD COLUMN "planExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "users" ADD COLUMN "stripeSubscriptionId" TEXT; 