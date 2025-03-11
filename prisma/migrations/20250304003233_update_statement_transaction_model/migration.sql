/*
  Warnings:

  - You are about to drop the column `isMatched` on the `statement_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `transactionId` on the `statement_transactions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[matchedTransactionId]` on the table `statement_transactions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `type` to the `statement_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "statement_transactions" DROP CONSTRAINT "statement_transactions_transactionId_fkey";

-- DropIndex
DROP INDEX "statement_transactions_transactionId_key";

-- AlterTable
ALTER TABLE "statement_transactions" DROP COLUMN "isMatched",
DROP COLUMN "transactionId",
ADD COLUMN     "isReconciled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matchedTransactionId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "statement_transactions_matchedTransactionId_key" ON "statement_transactions"("matchedTransactionId");

-- AddForeignKey
ALTER TABLE "statement_transactions" ADD CONSTRAINT "statement_transactions_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
