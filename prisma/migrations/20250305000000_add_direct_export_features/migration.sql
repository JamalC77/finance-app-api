-- Add useDirectExport field to QuickbooksConnection
ALTER TABLE "quickbooks_connections" ADD COLUMN "useDirectExport" BOOLEAN;

-- Create DirectExportLog table
CREATE TABLE "direct_export_logs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "entityType" TEXT,
  "accountsCount" INTEGER,
  "transactionsCount" INTEGER,
  "invoicesCount" INTEGER,
  "contactsCount" INTEGER,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  
  CONSTRAINT "direct_export_logs_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "direct_export_logs_organizationId_idx" ON "direct_export_logs"("organizationId");
CREATE INDEX "direct_export_logs_status_idx" ON "direct_export_logs"("status");

-- Add foreign key constraint
ALTER TABLE "direct_export_logs" ADD CONSTRAINT "direct_export_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE; 