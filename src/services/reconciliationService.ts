import { ReconciliationStatement, StatementTransaction, Prisma } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface StatementTransactionInput {
  date: Date;
  description: string;
  amount: number;
  reference?: string;
  type: string;
  isReconciled?: boolean;
  matchedTransactionId?: string;
}

export interface ReconciliationStatementData {
  name: string;
  statementDate: Date;
  endingBalance: number;
  accountId: string;
  status?: string;
  reconciledBalance?: number;
  statementTransactions?: StatementTransactionInput[];
}

// Define type to extend ReconciliationStatement with transactions
type ReconciliationStatementWithTransactions = ReconciliationStatement & {
  transactions: StatementTransaction[];
};

export class ReconciliationService implements BaseService<ReconciliationStatement> {
  async create(data: ReconciliationStatementData, organizationId: string): Promise<ReconciliationStatement> {
    const { statementTransactions, ...statementData } = data;
    
    return prisma.$transaction(async (prismaClient) => {
      // Create statement using raw SQL to bypass type restrictions
      const [statement] = await prismaClient.$queryRaw<{id: string}[]>`
        INSERT INTO reconciliation_statements (
          "organizationId",
          name,
          "statementDate",
          "endingBalance",
          "accountId",
          status,
          "reconciledBalance",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${organizationId},
          ${statementData.name},
          ${new Date(statementData.statementDate)},
          ${statementData.endingBalance},
          ${statementData.accountId},
          ${statementData.status || 'IN_PROGRESS'},
          ${statementData.reconciledBalance || null},
          NOW(),
          NOW()
        )
        RETURNING *
      `;
      
      // Add statement transactions if provided
      if (statementTransactions && statementTransactions.length > 0) {
        for (const transaction of statementTransactions) {
          await prismaClient.$queryRaw`
            INSERT INTO statement_transactions (
              "statementId",
              date,
              description,
              amount,
              reference,
              type,
              "isReconciled",
              "matchedTransactionId",
              "createdAt",
              "updatedAt"
            )
            VALUES (
              ${statement.id},
              ${new Date(transaction.date)},
              ${transaction.description},
              ${transaction.amount},
              ${transaction.reference || null},
              ${transaction.type},
              ${transaction.isReconciled || false},
              ${transaction.matchedTransactionId || null},
              NOW(),
              NOW()
            )
          `;
        }
      }
      
      // Return the created statement
      return statement as unknown as ReconciliationStatement;
    });
  }

  // For the findById and findAll methods, cast the return type to ReconciliationStatement
  async findById(id: string, organizationId: string): Promise<ReconciliationStatement | null> {
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        account: true,
        transactions: {
          include: {
            matchedTransaction: true
          }
        }
      }
    });
    
    return statement as unknown as ReconciliationStatement | null;
  }

  async findAll(organizationId: string, options?: { accountId?: string, status?: string }): Promise<ReconciliationStatement[]> {
    const statements = await prisma.reconciliationStatement.findMany({
      where: {
        organizationId,
        ...(options?.accountId && { accountId: options.accountId }),
        ...(options?.status && { status: options.status })
      },
      include: {
        account: true,
        transactions: true
      },
      orderBy: { statementDate: 'desc' }
    });
    
    return statements as unknown as ReconciliationStatement[];
  }

  // Also update the update method to use raw SQL
  async update(id: string, data: ReconciliationStatementData, organizationId: string): Promise<ReconciliationStatement> {
    const { statementTransactions, ...statementData } = data;
    
    return prisma.$transaction(async (prismaClient) => {
      // First check that the statement exists and belongs to the organization
      const existingStatement = await prismaClient.reconciliationStatement.findFirst({
        where: {
          id,
          organizationId
        }
      });
      
      if (!existingStatement) {
        throw new Error('Reconciliation statement not found');
      }
      
      // Update statement
      const [statement] = await prismaClient.$queryRaw<ReconciliationStatement[]>`
        UPDATE reconciliation_statements
        SET
          name = ${statementData.name || existingStatement.name},
          "statementDate" = ${new Date(statementData.statementDate) || existingStatement.statementDate},
          "endingBalance" = ${statementData.endingBalance || existingStatement.endingBalance},
          "accountId" = ${statementData.accountId || existingStatement.accountId},
          status = ${statementData.status || existingStatement.status},
          "reconciledBalance" = ${statementData.reconciledBalance || existingStatement.reconciledBalance},
          "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
      
      // Handle statement transactions if provided
      if (statementTransactions) {
        // Delete existing transactions
        await prismaClient.statementTransaction.deleteMany({
          where: { statementId: id }
        });
        
        // Add new transactions
        if (statementTransactions.length > 0) {
          for (const transaction of statementTransactions) {
            await prismaClient.$queryRaw`
              INSERT INTO statement_transactions (
                "statementId",
                date,
                description,
                amount,
                reference,
                type,
                "isReconciled",
                "matchedTransactionId",
                "createdAt",
                "updatedAt"
              )
              VALUES (
                ${id},
                ${new Date(transaction.date)},
                ${transaction.description},
                ${transaction.amount},
                ${transaction.reference || null},
                ${transaction.type},
                ${transaction.isReconciled || false},
                ${transaction.matchedTransactionId || null},
                NOW(),
                NOW()
              )
            `;
          }
        }
      }
      
      // Return the updated statement
      return statement;
    });
  }

  async delete(id: string, organizationId: string): Promise<ReconciliationStatement> {
    return prisma.$transaction(async (tx) => {
      // Delete statement transactions first
      await tx.statementTransaction.deleteMany({
        where: { statementId: id }
      });
      
      // Get statement before deleting
      const statement = await tx.reconciliationStatement.findUnique({
        where: { id }
      });
      
      // Delete the statement
      await tx.reconciliationStatement.delete({
        where: { id }
      });
      
      return statement as ReconciliationStatement;
    });
  }

  async matchTransactions(statementId: string, matches: { statementTransactionId: string, transactionId: string }[]): Promise<void> {
    await prisma.$transaction(
      matches.map(match => 
        prisma.statementTransaction.update({
          where: { id: match.statementTransactionId },
          data: { 
            isReconciled: true,
            matchedTransactionId: match.transactionId
          }
        })
      )
    );
  }

  async completeReconciliation(id: string, organizationId: string): Promise<ReconciliationStatement> {
    // Get the statement with transactions
    const statement = await prisma.reconciliationStatement.findUnique({
      where: { id },
      include: {
        transactions: true
      }
    }) as unknown as { 
      id: string; 
      endingBalance: number;
      transactions: Array<{
        isReconciled: boolean;
        matchedTransactionId?: string;
        amount: number;
      }>;
    };
    
    if (!statement) {
      throw new Error('Reconciliation statement not found');
    }
    
    // Calculate totals
    const totalMatched = statement.transactions.reduce((sum: number, tx) => 
      tx.isReconciled ? sum + tx.amount : sum, 0
    );
    
    // Mark as reconciled and update transactions
    return prisma.$transaction(async (tx) => {
      // Update all matched transactions to RECONCILED status
      for (const stx of statement.transactions) {
        if (stx.isReconciled && stx.matchedTransactionId) {
          await tx.transaction.update({
            where: { id: stx.matchedTransactionId },
            data: { status: 'RECONCILED' }
          });
        }
      }
      
      // Mark the statement as reconciled
      const updatedStatement = await tx.reconciliationStatement.update({
        where: { id },
        data: { 
          status: 'RECONCILED',
          reconciledBalance: statement.endingBalance
        }
      });
      
      return updatedStatement as unknown as ReconciliationStatement;
    });
  }
}

export const reconciliationService = new ReconciliationService(); 