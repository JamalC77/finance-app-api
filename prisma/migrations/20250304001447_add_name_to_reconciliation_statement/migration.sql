/*
  Warnings:

  - You are about to drop the column `beginningBalance` on the `reconciliation_statements` table. All the data in the column will be lost.
  - You are about to drop the column `isReconciled` on the `reconciliation_statements` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `reconciliation_statements` table. All the data in the column will be lost.
  - Added the required column `name` to the `reconciliation_statements` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "reconciliation_statements" DROP COLUMN "beginningBalance",
DROP COLUMN "isReconciled",
DROP COLUMN "notes",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS';
