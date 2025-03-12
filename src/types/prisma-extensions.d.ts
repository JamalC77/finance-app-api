import { Prisma } from '@prisma/client';

// Add missing properties to ReconciliationStatement
declare global {
  namespace PrismaJson {
    interface ReconciliationStatementInclude {
      statementTransactions?: boolean;
    }
  }
}

// Extend Prisma namespace
declare namespace Prisma {
  // Add missing properties to ReconciliationStatement
  interface ReconciliationStatementInclude {
    statementTransactions?: boolean;
  }

  // Add missing properties to StatementTransaction
  interface StatementTransactionUpdateInput {
    isMatched?: boolean;
    transactionId?: string | null;
  }

  // Fix invoice line items
  interface InvoiceLineItemCreateNestedManyWithoutInvoiceInput {
    create?: any[];
  }

  interface InvoiceLineItemUpdateManyWithoutInvoiceNestedInput {
    create?: any[];
  }
}

// Add missing properties to ReconciliationStatement model
declare module '@prisma/client' {
  interface ReconciliationStatement {
    statementTransactions?: any[];
    beginningBalance?: number;
  }
} 