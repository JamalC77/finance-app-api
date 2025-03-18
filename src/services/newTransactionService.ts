import { Transaction, LedgerEntry, TransactionStatus, Prisma } from '@prisma/client';
import { BaseService, prisma } from './baseService';

export interface LedgerEntryInput {
  amount: number;
  memo?: string;
  debitAccountId?: string;
  creditAccountId?: string;
}

export interface TransactionData {
  date: Date | string;
  description: string;
  reference?: string;
  status?: TransactionStatus;
  invoiceId?: string;
  expenseId?: string;
  bankTransactionId?: string;
  ledgerEntries: LedgerEntryInput[];
}

export interface TransactionCreateInput extends Omit<Prisma.TransactionCreateInput, 'organization' | 'ledgerEntries'> {
  ledgerEntries: LedgerEntryInput[];
}

export interface TransactionUpdateInput extends Omit<Prisma.TransactionUpdateInput, 'organization' | 'ledgerEntries'> {
  ledgerEntries?: LedgerEntryInput[];
}

export class TransactionService implements BaseService<Transaction> {
  async create(data: TransactionData, organizationId: string): Promise<Transaction> {
    const { ledgerEntries, ...transactionData } = data;
    
    // Verify that ledger entries balance (debits = credits)
    this.verifyLedgerEntriesBalance(ledgerEntries);
    
    return prisma.$transaction(async (prismaClient) => {
      // Create the transaction
      // We need to use raw query to bypass Prisma's type restrictions
      const [transaction] = await prismaClient.$queryRaw<Transaction[]>`
        INSERT INTO transactions (
          "organizationId", 
          date, 
          description, 
          reference, 
          status, 
          "invoiceId", 
          "expenseId", 
          "bankTransactionId",
          "createdAt",
          "updatedAt"
        ) 
        VALUES (
          ${organizationId}, 
          ${new Date(data.date as any)}, 
          ${data.description}, 
          ${data.reference || null}, 
          ${data.status || 'PENDING'}, 
          ${data.invoiceId || null}, 
          ${data.expenseId || null}, 
          ${data.bankTransactionId || null},
          NOW(),
          NOW()
        )
        RETURNING *
      `;
      
      // Create ledger entries
      if (ledgerEntries && ledgerEntries.length > 0) {
        for (const entry of ledgerEntries) {
          await prismaClient.$queryRaw`
            INSERT INTO ledger_entries (
              "transactionId",
              amount,
              memo,
              "debitAccountId",
              "creditAccountId",
              "createdAt",
              "updatedAt"
            )
            VALUES (
              ${transaction.id},
              ${entry.amount},
              ${entry.memo || null},
              ${entry.debitAccountId || null},
              ${entry.creditAccountId || null},
              NOW(),
              NOW()
            )
          `;
        }
      }
      
      // Return the created transaction with ledger entries
      return prismaClient.transaction.findUnique({
        where: { id: transaction.id },
        include: { ledgerEntries: true }
      }) as Promise<Transaction>;
    });
  }

  async findById(id: string, organizationId: string): Promise<Transaction | null> {
    return prisma.transaction.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        ledgerEntries: {
          include: {
            debitAccount: true,
            creditAccount: true
          }
        },
        invoice: true,
        expense: true
      }
    });
  }

  async findAll(organizationId: string, options?: { 
    status?: TransactionStatus,
    startDate?: Date,
    endDate?: Date,
    accountId?: string
  }): Promise<Transaction[]> {
    // If accountId is provided, we need to find transactions where the account is either debited or credited
    if (options?.accountId) {
      return prisma.transaction.findMany({
        where: {
          organizationId,
          ...(options?.status && { status: options.status }),
          ...(options?.startDate && { date: { gte: options.startDate } }),
          ...(options?.endDate && { date: { lte: options.endDate } }),
          ledgerEntries: {
            some: {
              OR: [
                { debitAccountId: options.accountId },
                { creditAccountId: options.accountId }
              ]
            }
          }
        },
        include: {
          ledgerEntries: {
            include: {
              debitAccount: true,
              creditAccount: true
            }
          }
        },
        orderBy: { date: 'desc' }
      });
    }
    
    // Regular query without account filter
    return prisma.transaction.findMany({
      where: {
        organizationId,
        ...(options?.status && { status: options.status }),
        ...(options?.startDate && { date: { gte: options.startDate } }),
        ...(options?.endDate && { date: { lte: options.endDate } })
      },
      include: {
        ledgerEntries: {
          include: {
            debitAccount: true,
            creditAccount: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });
  }

  async update(id: string, data: TransactionData, organizationId: string): Promise<Transaction> {
    const { ledgerEntries, ...transactionData } = data;
    
    // Verify that ledger entries balance if provided
    if (ledgerEntries) {
      this.verifyLedgerEntriesBalance(ledgerEntries);
    }
    
    return prisma.$transaction(async (tx) => {
      // Update the transaction
      const transaction = await tx.transaction.update({
        where: {
          id,
        },
        data: transactionData
      });
      
      // Handle ledger entries if they're provided
      if (ledgerEntries) {
        // Delete existing ledger entries
        await tx.ledgerEntry.deleteMany({
          where: { transactionId: id }
        });
        
        // Create new ledger entries
        if (ledgerEntries.length > 0) {
          for (const entry of ledgerEntries) {
            const ledgerData = {
              amount: entry.amount,
              memo: entry.memo,
              transaction: {
                connect: { id: id }
              }
            };
            
            // Add debit account if present
            if (entry.debitAccountId) {
              Object.assign(ledgerData, {
                debitAccount: {
                  connect: { id: entry.debitAccountId }
                }
              });
            }
            
            // Add credit account if present
            if (entry.creditAccountId) {
              Object.assign(ledgerData, {
                creditAccount: {
                  connect: { id: entry.creditAccountId }
                }
              });
            }
            
            await tx.ledgerEntry.create({
              data: ledgerData
            });
          }
        }
      }
      
      // Return the updated transaction with ledger entries
      return tx.transaction.findUnique({
        where: { id: transaction.id },
        include: {
          ledgerEntries: {
            include: {
              debitAccount: true,
              creditAccount: true
            }
          }
        }
      }) as Promise<Transaction>;
    });
  }

  async delete(id: string, organizationId: string): Promise<Transaction> {
    return prisma.$transaction(async (tx) => {
      // Delete ledger entries first
      await tx.ledgerEntry.deleteMany({
        where: { transactionId: id }
      });
      
      // Get transaction before deleting
      const transaction = await tx.transaction.findUnique({
        where: { id }
      });
      
      // Delete the transaction
      await tx.transaction.delete({
        where: { id }
      });
      
      return transaction as Transaction;
    });
  }

  async updateStatus(id: string, status: TransactionStatus, organizationId: string): Promise<Transaction> {
    return prisma.transaction.update({
      where: {
        id,
      },
      data: { status }
    });
  }
  
  // Utility methods
  private verifyLedgerEntriesBalance(entries: LedgerEntryInput[]): void {
    let totalDebits = 0;
    let totalCredits = 0;
    
    entries.forEach(entry => {
      if (entry.debitAccountId) {
        totalDebits += entry.amount;
      }
      if (entry.creditAccountId) {
        totalCredits += entry.amount;
      }
    });
    
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01; // Allow small rounding errors
    
    if (!isBalanced) {
      throw new Error('Transaction does not balance. Total debits must equal total credits.');
    }
  }
  
  async getGeneralLedger(organizationId: string, options?: {
    startDate?: Date,
    endDate?: Date,
    accountId?: string
  }): Promise<any> {
    const whereClause: any = {
      organizationId,
      status: { not: 'VOIDED' }
    };
    
    if (options?.startDate) {
      whereClause.date = { ...(whereClause.date || {}), gte: options.startDate };
    }
    
    if (options?.endDate) {
      whereClause.date = { ...(whereClause.date || {}), lte: options.endDate };
    }
    
    // Get all transactions in date range
    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        ledgerEntries: {
          include: {
            debitAccount: true,
            creditAccount: true
          }
        }
      },
      orderBy: [
        { date: 'asc' },
        { createdAt: 'asc' }
      ]
    });
    
    // Filter by account if specified
    if (options?.accountId) {
      return transactions.filter(transaction => 
        transaction.ledgerEntries.some(entry => 
          entry.debitAccountId === options.accountId || entry.creditAccountId === options.accountId
        )
      );
    }
    
    return transactions;
  }
}

export const transactionService = new TransactionService(); 