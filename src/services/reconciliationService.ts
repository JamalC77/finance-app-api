import { ReconciliationStatement, StatementTransaction, Prisma } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface StatementTransactionInput extends Omit<Prisma.StatementTransactionUncheckedCreateInput, 'statementId'> {}

export interface ReconciliationStatementCreateInput extends Omit<Prisma.ReconciliationStatementUncheckedCreateInput, 'organizationId'> {
  statementTransactions?: StatementTransactionInput[];
}

export interface ReconciliationStatementUpdateInput extends Omit<Prisma.ReconciliationStatementUncheckedUpdateInput, 'organizationId'> {
  statementTransactions?: StatementTransactionInput[];
}

export class ReconciliationService implements BaseService<ReconciliationStatement> {
  async create(data: ReconciliationStatementCreateInput, organizationId: string): Promise<ReconciliationStatement> {
    const { statementTransactions, ...statementData } = data;
    
    return prisma.$transaction(async (tx) => {
      // Create the reconciliation statement
      const statement = await tx.reconciliationStatement.create({
        data: {
          ...statementData,
          organizationId
        }
      });
      
      // Add statement transactions if provided
      if (statementTransactions && statementTransactions.length > 0) {
        await Promise.all(
          statementTransactions.map(transaction => 
            tx.statementTransaction.create({
              data: {
                ...transaction,
                statementId: statement.id
              }
            })
          )
        );
      }
      
      // Return the created statement with transactions
      return tx.reconciliationStatement.findUnique({
        where: { id: statement.id },
        include: { statementTransactions: true }
      }) as Promise<ReconciliationStatement>;
    });
  }

  async findById(id: string, organizationId: string): Promise<ReconciliationStatement | null> {
    return prisma.reconciliationStatement.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        account: true,
        statementTransactions: {
          include: {
            transaction: true
          }
        }
      }
    });
  }

  async findAll(organizationId: string, options?: { accountId?: string, isReconciled?: boolean }): Promise<ReconciliationStatement[]> {
    return prisma.reconciliationStatement.findMany({
      where: {
        organizationId,
        ...(options?.accountId && { accountId: options.accountId }),
        ...(options?.isReconciled !== undefined && { isReconciled: options.isReconciled })
      },
      include: {
        account: true,
        statementTransactions: true
      },
      orderBy: { statementDate: 'desc' }
    });
  }

  async update(id: string, data: ReconciliationStatementUpdateInput, organizationId: string): Promise<ReconciliationStatement> {
    const { statementTransactions, ...statementData } = data;
    
    return prisma.$transaction(async (tx) => {
      // Update the reconciliation statement
      const statement = await tx.reconciliationStatement.update({
        where: {
          id,
        },
        data: statementData
      });
      
      // Handle statement transactions if provided
      if (statementTransactions) {
        // Delete existing transactions
        await tx.statementTransaction.deleteMany({
          where: { statementId: id }
        });
        
        // Add new transactions
        if (statementTransactions.length > 0) {
          await Promise.all(
            statementTransactions.map(transaction => 
              tx.statementTransaction.create({
                data: {
                  ...transaction,
                  statementId: id
                }
              })
            )
          );
        }
      }
      
      // Return the updated statement with transactions
      return tx.reconciliationStatement.findUnique({
        where: { id: statement.id },
        include: { 
          statementTransactions: true,
          account: true
        }
      }) as Promise<ReconciliationStatement>;
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
            isMatched: true,
            transactionId: match.transactionId
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
        statementTransactions: true
      }
    });
    
    if (!statement) {
      throw new Error('Reconciliation statement not found');
    }
    
    // Calculate totals
    const totalMatched = statement.statementTransactions.reduce((sum: number, tx) => 
      tx.isMatched ? sum + tx.amount : sum, 0
    );
    
    const difference = statement.endingBalance - (statement.beginningBalance + totalMatched);
    
    // Mark as reconciled and update transactions
    return prisma.$transaction(async (tx) => {
      // Update all matched transactions to RECONCILED status
      await Promise.all(
        statement.statementTransactions
          .filter((stx: any) => stx.isMatched && stx.transactionId)
          .map((stx: any) => 
            tx.transaction.update({
              where: { id: stx.transactionId! },
              data: { status: 'RECONCILED' }
            })
          )
      );
      
      // Mark the statement as reconciled
      return tx.reconciliationStatement.update({
        where: { id },
        data: { 
          status: 'RECONCILED',
          reconciledBalance: statement.endingBalance
        }
      });
    });
  }
}

export const reconciliationService = new ReconciliationService(); 