-- CreateEnum
CREATE TYPE "SyncFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('CASH_FLOW', 'PROFITABILITY', 'EXPENSE', 'RECEIVABLES', 'TAX', 'BUDGET', 'GENERAL');

-- CreateTable
CREATE TABLE "quickbooks_connections" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "syncFrequency" "SyncFrequency" NOT NULL DEFAULT 'DAILY',
    "syncSettings" JSONB,

    CONSTRAINT "quickbooks_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_account_mappings" (
    "id" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "localAccountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "quickbooks_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_contact_mappings" (
    "id" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "localContactId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "quickbooks_contact_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_invoice_mappings" (
    "id" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "localInvoiceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "quickbooks_invoice_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quickbooks_transaction_mappings" (
    "id" TEXT NOT NULL,
    "quickbooksId" TEXT NOT NULL,
    "localTransactionId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "quickbooks_transaction_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_insights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_connections_organizationId_key" ON "quickbooks_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_account_mappings_connectionId_quickbooksId_key" ON "quickbooks_account_mappings"("connectionId", "quickbooksId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_contact_mappings_connectionId_quickbooksId_key" ON "quickbooks_contact_mappings"("connectionId", "quickbooksId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_invoice_mappings_connectionId_quickbooksId_key" ON "quickbooks_invoice_mappings"("connectionId", "quickbooksId");

-- CreateIndex
CREATE UNIQUE INDEX "quickbooks_transaction_mappings_connectionId_quickbooksId_key" ON "quickbooks_transaction_mappings"("connectionId", "quickbooksId");

-- AddForeignKey
ALTER TABLE "quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_account_mappings" ADD CONSTRAINT "quickbooks_account_mappings_localAccountId_fkey" FOREIGN KEY ("localAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_account_mappings" ADD CONSTRAINT "quickbooks_account_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "quickbooks_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_contact_mappings" ADD CONSTRAINT "quickbooks_contact_mappings_localContactId_fkey" FOREIGN KEY ("localContactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_contact_mappings" ADD CONSTRAINT "quickbooks_contact_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "quickbooks_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_invoice_mappings" ADD CONSTRAINT "quickbooks_invoice_mappings_localInvoiceId_fkey" FOREIGN KEY ("localInvoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_invoice_mappings" ADD CONSTRAINT "quickbooks_invoice_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "quickbooks_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_transaction_mappings" ADD CONSTRAINT "quickbooks_transaction_mappings_localTransactionId_fkey" FOREIGN KEY ("localTransactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quickbooks_transaction_mappings" ADD CONSTRAINT "quickbooks_transaction_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "quickbooks_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "quickbooks_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_insights" ADD CONSTRAINT "financial_insights_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE; 