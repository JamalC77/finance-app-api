import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get all transactions for the organization, with support for filtering
 * @route GET /api/transactions
 */
export const getAllTransactions = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }

    // Extract query parameters for filtering
    const { 
      accountId, 
      category, 
      startDate, 
      endDate, 
      minAmount, 
      maxAmount, 
      query 
    } = req.query;
    
    // Build filter conditions
    const filters: any = { organizationId };
    
    if (accountId) {
      filters.accountId = accountId as string;
    }
    
    if (category) {
      filters.category = category as string;
    }
    
    // Date range filter
    if (startDate || endDate) {
      filters.date = {};
      if (startDate) {
        filters.date.gte = new Date(startDate as string);
      }
      if (endDate) {
        filters.date.lte = new Date(endDate as string);
      }
    }
    
    // Amount range filter
    if (minAmount || maxAmount) {
      filters.amount = {};
      if (minAmount) {
        filters.amount.gte = parseFloat(minAmount as string);
      }
      if (maxAmount) {
        filters.amount.lte = parseFloat(maxAmount as string);
      }
    }
    
    // Text search filter
    if (query) {
      filters.OR = [
        { description: { contains: query as string, mode: 'insensitive' } },
        { reference: { contains: query as string, mode: 'insensitive' } }
      ];
    }
    
    const transactions = await prisma.transaction.findMany({
      where: filters,
      include: {
        ledgerEntries: {
          include: {
            debitAccount: true,
            creditAccount: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    
    return res.status(200).json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
};

/**
 * Get a specific transaction by ID
 * @route GET /api/transactions/:id
 */
export const getTransactionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    const transaction = await prisma.transaction.findFirst({
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
        }
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    return res.status(200).json(transaction);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return res.status(500).json({ error: 'Failed to fetch transaction' });
  }
};

/**
 * Create a new transaction
 * @route POST /api/transactions
 */
export const createTransaction = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    const { description, date, reference, status, ledgerEntries } = req.body;
    
    // Validate required fields
    if (!description || !date || !ledgerEntries || !Array.isArray(ledgerEntries) || ledgerEntries.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create the transaction with ledger entries in a transaction
    const transaction = await prisma.$transaction(async (tx) => {
      // Create the transaction
      const newTransaction = await tx.transaction.create({
        data: {
          description,
          date: new Date(date),
          reference: reference || null,
          status: status || 'PENDING',
          organizationId
        }
      });
      
      // Create ledger entries
      for (const entry of ledgerEntries) {
        await tx.ledgerEntry.create({
          data: {
            transactionId: newTransaction.id,
            amount: parseFloat(entry.amount.toString()),
            memo: entry.memo || null,
            debitAccountId: entry.debitAccountId || null,
            creditAccountId: entry.creditAccountId || null
          }
        });
        
        // Update account balances
        if (entry.debitAccountId) {
          await tx.account.update({
            where: { id: entry.debitAccountId },
            data: { balance: { increment: parseFloat(entry.amount.toString()) } }
          });
        }
        
        if (entry.creditAccountId) {
          await tx.account.update({
            where: { id: entry.creditAccountId },
            data: { balance: { decrement: parseFloat(entry.amount.toString()) } }
          });
        }
      }
      
      // Return the transaction with ledger entries
      return tx.transaction.findUnique({
        where: { id: newTransaction.id },
        include: {
          ledgerEntries: {
            include: {
              debitAccount: true,
              creditAccount: true
            }
          }
        }
      });
    });
    
    return res.status(201).json(transaction);
  } catch (error) {
    console.error('Error creating transaction:', error);
    return res.status(500).json({ error: 'Failed to create transaction' });
  }
};

/**
 * Update an existing transaction
 * @route PUT /api/transactions/:id
 */
export const updateTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    // First, get the existing transaction to check permission
    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        ledgerEntries: true
      }
    });
    
    if (!existingTransaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    const { description, date, reference, status, ledgerEntries } = req.body;
    
    // Update the transaction in a transaction to ensure consistency
    const updatedTransaction = await prisma.$transaction(async (tx) => {
      // Update the transaction
      const transaction = await tx.transaction.update({
        where: { id },
        data: {
          description: description || existingTransaction.description,
          date: date ? new Date(date) : existingTransaction.date,
          reference: reference !== undefined ? reference : existingTransaction.reference,
          status: status || existingTransaction.status
        }
      });
      
      // If ledger entries are provided, update them
      if (ledgerEntries && Array.isArray(ledgerEntries)) {
        // First, delete existing ledger entries
        for (const entry of existingTransaction.ledgerEntries) {
          // Reverse the impact on account balances
          if (entry.debitAccountId) {
            await tx.account.update({
              where: { id: entry.debitAccountId },
              data: { balance: { decrement: entry.amount } }
            });
          }
          
          if (entry.creditAccountId) {
            await tx.account.update({
              where: { id: entry.creditAccountId },
              data: { balance: { increment: entry.amount } }
            });
          }
          
          // Delete the entry
          await tx.ledgerEntry.delete({
            where: { id: entry.id }
          });
        }
        
        // Create new ledger entries
        for (const entry of ledgerEntries) {
          await tx.ledgerEntry.create({
            data: {
              transactionId: transaction.id,
              amount: parseFloat(entry.amount.toString()),
              memo: entry.memo || null,
              debitAccountId: entry.debitAccountId || null,
              creditAccountId: entry.creditAccountId || null
            }
          });
          
          // Update account balances
          if (entry.debitAccountId) {
            await tx.account.update({
              where: { id: entry.debitAccountId },
              data: { balance: { increment: parseFloat(entry.amount.toString()) } }
            });
          }
          
          if (entry.creditAccountId) {
            await tx.account.update({
              where: { id: entry.creditAccountId },
              data: { balance: { decrement: parseFloat(entry.amount.toString()) } }
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
      });
    });
    
    return res.status(200).json(updatedTransaction);
  } catch (error) {
    console.error('Error updating transaction:', error);
    return res.status(500).json({ error: 'Failed to update transaction' });
  }
};

/**
 * Delete a transaction
 * @route DELETE /api/transactions/:id
 */
export const deleteTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    // Get the transaction first to check ownership and get the ledger entries
    const transaction = await prisma.transaction.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        ledgerEntries: true
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Delete the transaction and update account balances in a transaction
    await prisma.$transaction(async (tx) => {
      // Reverse the impact on account balances for each ledger entry
      for (const entry of transaction.ledgerEntries) {
        if (entry.debitAccountId) {
          await tx.account.update({
            where: { id: entry.debitAccountId },
            data: { balance: { decrement: entry.amount } }
          });
        }
        
        if (entry.creditAccountId) {
          await tx.account.update({
            where: { id: entry.creditAccountId },
            data: { balance: { increment: entry.amount } }
          });
        }
      }
      
      // Delete the transaction (this will cascade delete the ledger entries)
      await tx.transaction.delete({
        where: { id }
      });
    });
    
    return res.status(200).json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return res.status(500).json({ error: 'Failed to delete transaction' });
  }
};

/**
 * Get transaction statistics
 * @route GET /api/transactions/stats
 */
export const getTransactionStats = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    const { startDate, endDate, accountId } = req.query;
    
    // Default to current month if no dates specified
    const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(1));
    const end = endDate ? new Date(endDate as string) : new Date(new Date().setMonth(new Date().getMonth() + 1, 0));
    
    // Build where clause for transactions
    const where: any = {
      organizationId,
      date: {
        gte: start,
        lte: end
      }
    };
    
    // Get all transactions in the date range
    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        ledgerEntries: {
          include: {
            debitAccount: true,
            creditAccount: true
          }
        }
      }
    });
    
    // Calculate income and expenses from ledger entries
    let income = 0;
    let expenses = 0;
    const accountTotals: Record<string, { name: string, debit: number, credit: number }> = {};
    
    for (const transaction of transactions) {
      for (const entry of transaction.ledgerEntries) {
        // If accountId is specified, only include entries for that account
        if (accountId && entry.debitAccountId !== accountId && entry.creditAccountId !== accountId) {
          continue;
        }
        
        // Track income (credit to income accounts) and expenses (debit to expense accounts)
        if (entry.debitAccount && entry.debitAccount.type === 'EXPENSE') {
          expenses += entry.amount;
        }
        
        if (entry.creditAccount && entry.creditAccount.type === 'REVENUE') {
          income += entry.amount;
        }
        
        // Track account totals
        if (entry.debitAccountId) {
          if (!accountTotals[entry.debitAccountId]) {
            accountTotals[entry.debitAccountId] = {
              name: entry.debitAccount?.name || 'Unknown Account',
              debit: 0,
              credit: 0
            };
          }
          accountTotals[entry.debitAccountId].debit += entry.amount;
        }
        
        if (entry.creditAccountId) {
          if (!accountTotals[entry.creditAccountId]) {
            accountTotals[entry.creditAccountId] = {
              name: entry.creditAccount?.name || 'Unknown Account',
              debit: 0,
              credit: 0
            };
          }
          accountTotals[entry.creditAccountId].credit += entry.amount;
        }
      }
    }
    
    return res.status(200).json({
      income,
      expenses,
      net: income - expenses,
      accountTotals: Object.entries(accountTotals).map(([id, data]) => ({
        id,
        ...data,
        net: data.debit - data.credit
      })),
      startDate: start,
      endDate: end
    });
  } catch (error) {
    console.error('Error fetching transaction statistics:', error);
    return res.status(500).json({ error: 'Failed to fetch transaction statistics' });
  }
}; 