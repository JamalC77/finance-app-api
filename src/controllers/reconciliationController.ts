import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
// @ts-ignore
const csv = require('csv-parser');
import * as fs from 'fs';
import { Readable } from 'stream';
// @ts-ignore
const ofx = require('ofx');

const prisma = new PrismaClient();

/**
 * Get reconciliation statements for an account
 */
export const getStatements = async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' });
    }
    
    // Verify account belongs to organization
    const account = await prisma.account.findFirst({
      where: {
        id: accountId,
        organizationId
      }
    });
    
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    // Get statements for the account
    const statements = await prisma.reconciliationStatement.findMany({
      where: {
        accountId,
        organizationId
      },
      orderBy: {
        statementDate: 'desc'
      }
    });
    
    return res.status(200).json({ statements });
  } catch (error: any) {
    console.error('Error in getStatements controller:', error);
    return res.status(500).json({
      error: 'Failed to get statements',
      message: error.message
    });
  }
};

/**
 * Create a new reconciliation statement
 */
export const createStatement = async (req: Request, res: Response) => {
  try {
    const { accountId, startDate, endDate, startingBalance, endingBalance } = req.body;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' });
    }
    
    // Verify account belongs to organization
    const account = await prisma.account.findFirst({
      where: {
        id: accountId,
        organizationId
      }
    });
    
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    // Create new statement
    const statement = await prisma.reconciliationStatement.create({
      data: {
        id: uuidv4(),
        accountId,
        organizationId,
        name: `Statement for ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`,
        statementDate: new Date(startDate),
        endingBalance: parseFloat(endingBalance),
        status: 'IN_PROGRESS'
      }
    });
    
    return res.status(201).json({ statement });
  } catch (error: any) {
    console.error('Error in createStatement controller:', error);
    return res.status(500).json({
      error: 'Failed to create statement',
      message: error.message
    });
  }
};

/**
 * Get a reconciliation statement by ID
 */
export const getStatement = async (req: Request, res: Response) => {
  try {
    const statementId = req.params.id;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!statementId) {
      return res.status(400).json({ error: 'Statement ID is required' });
    }
    
    // Get statement with transactions
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id: statementId,
        organizationId
      },
      include: {
        account: true,
        transactions: true
      }
    });
    
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    // Get unreconciled transactions for the account
    const unreconciledTransactions = await prisma.transaction.findMany({
      where: {
        organizationId,
        ledgerEntries: {
          some: {
            OR: [
              { debitAccountId: statement.accountId },
              { creditAccountId: statement.accountId }
            ]
          }
        },
        status: 'CLEARED',
        date: {
          lte: statement.statementDate
        },
        matchedStatementTransaction: null
      },
      include: {
        ledgerEntries: true
      }
    });
    
    return res.status(200).json({ 
      statement,
      unreconciledTransactions
    });
  } catch (error: any) {
    console.error('Error in getStatement controller:', error);
    return res.status(500).json({
      error: 'Failed to get statement',
      message: error.message
    });
  }
};

/**
 * Import transactions from a CSV/OFX file
 */
export const importStatementTransactions = async (req: Request, res: Response) => {
  try {
    const statementId = req.params.id;
    const organizationId = req.user?.organizationId;
    const { fileContent, fileType } = req.body;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!statementId || !fileContent || !fileType) {
      return res.status(400).json({ 
        error: 'Statement ID, file content, and file type are required' 
      });
    }
    
    // Verify statement belongs to organization
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id: statementId,
        organizationId
      }
    });
    
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    let importedTransactions = [];
    
    if (fileType === 'csv') {
      // Parse CSV content
      const buffer = Buffer.from(fileContent, 'base64');
      const readableStream = new Readable();
      readableStream.push(buffer);
      readableStream.push(null);
      
      const rows: Record<string, any>[] = [];
      await new Promise((resolve, reject) => {
        readableStream
          .pipe(csv())
          .on('data', (row: Record<string, any>) => rows.push(row))
          .on('error', reject)
          .on('end', resolve);
      });
      
      // Process CSV rows
      importedTransactions = await processCsvRows(rows, statement);
    } else if (fileType === 'ofx') {
      // Parse OFX content
      const buffer = Buffer.from(fileContent, 'base64');
      const ofxData = ofx.parse(buffer.toString());
      
      // Process OFX data
      importedTransactions = await processOfxData(ofxData, statement);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }
    
    return res.status(200).json({
      success: true,
      importedCount: importedTransactions.length,
      transactions: importedTransactions
    });
  } catch (error: any) {
    console.error('Error in importStatementTransactions controller:', error);
    return res.status(500).json({
      error: 'Failed to import transactions',
      message: error.message
    });
  }
};

/**
 * Process CSV rows into statement transactions
 */
const processCsvRows = async (rows: Record<string, any>[], statement: any) => {
  const importedTransactions = [];
  
  for (const row of rows) {
    try {
      // Attempt to map CSV columns to transaction fields
      // This may need customization based on the bank's CSV format
      const transaction = await prisma.statementTransaction.create({
        data: {
          id: uuidv4(),
          statementId: statement.id,
          date: new Date(row.Date || row.date || row.TransactionDate),
          description: row.Description || row.description || row.Memo,
          amount: parseFloat(row.Amount || row.amount || 0),
          reference: row.Reference || row.reference || row.TransactionId,
          type: row.Type || row.type || 'OTHER',
          isReconciled: false
        }
      });
      
      importedTransactions.push(transaction);
    } catch (error) {
      console.error('Error importing CSV row:', row, error);
      // Continue with next row
    }
  }
  
  return importedTransactions;
};

/**
 * Process OFX data into statement transactions
 */
const processOfxData = async (ofxData: any, statement: any) => {
  const importedTransactions = [];
  
  try {
    // Extract transactions from OFX data structure
    const transactions = ofxData.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN || [];
    
    for (const txn of Array.isArray(transactions) ? transactions : [transactions]) {
      // Create statement transaction from OFX data
      const transaction = await prisma.statementTransaction.create({
        data: {
          id: uuidv4(),
          statementId: statement.id,
          date: new Date(txn.DTPOSTED),
          description: txn.MEMO || txn.NAME,
          amount: parseFloat(txn.TRNAMT),
          reference: txn.FITID,
          type: mapOfxType(txn.TRNTYPE),
          isReconciled: false
        }
      });
      
      importedTransactions.push(transaction);
    }
  } catch (error) {
    console.error('Error processing OFX data:', error);
  }
  
  return importedTransactions;
};

/**
 * Map OFX transaction type to our system
 */
const mapOfxType = (ofxType: string) => {
  switch (ofxType) {
    case 'CREDIT': return 'CREDIT';
    case 'DEBIT': return 'DEBIT';
    case 'INT': return 'INTEREST';
    case 'DIV': return 'DIVIDEND';
    case 'FEE': return 'FEE';
    case 'SRVCHG': return 'FEE';
    case 'DEP': return 'DEPOSIT';
    case 'ATM': return 'ATM';
    case 'POS': return 'POS';
    case 'XFER': return 'TRANSFER';
    case 'CHECK': return 'CHECK';
    case 'PAYMENT': return 'PAYMENT';
    case 'CASH': return 'CASH';
    case 'DIRECTDEP': return 'DIRECT_DEPOSIT';
    case 'DIRECTDEBIT': return 'DIRECT_DEBIT';
    case 'REPEATPMT': return 'RECURRING_PAYMENT';
    default: return 'OTHER';
  }
};

/**
 * Auto-match transactions
 */
export const matchTransactions = async (req: Request, res: Response) => {
  try {
    const statementId = req.params.id;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const organizationId = req.user.organizationId;
    
    if (!statementId) {
      return res.status(400).json({ error: 'Statement ID is required' });
    }
    
    // Verify statement belongs to organization
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id: statementId,
        organizationId
      },
      include: {
        account: true
      }
    });
    
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    // Get unmatched statement transactions
    const statementTransactions = await prisma.statementTransaction.findMany({
      where: {
        statementId,
        matchedTransactionId: null
      }
    });
    
    // Get unreconciled transactions for matching
    const unreconciledTransactions = await prisma.transaction.findMany({
      where: {
        organizationId,
        ledgerEntries: {
          some: {
            OR: [
              { debitAccountId: statement.accountId },
              { creditAccountId: statement.accountId }
            ]
          }
        },
        status: 'CLEARED',
        date: {
          lte: statement.statementDate
        },
        matchedStatementTransaction: null
      },
      include: {
        ledgerEntries: {
          where: {
            OR: [
              { debitAccountId: statement.accountId },
              { creditAccountId: statement.accountId }
            ]
          }
        }
      }
    });
    
    const matchedCount = await matchTransactionsAlgorithm(
      statementTransactions,
      unreconciledTransactions,
      statement.accountId
    );
    
    return res.status(200).json({
      success: true,
      matchedCount
    });
  } catch (error: any) {
    console.error('Error in matchTransactions controller:', error);
    return res.status(500).json({
      error: 'Failed to match transactions',
      message: error.message
    });
  }
};

/**
 * Match transactions algorithm
 */
const matchTransactionsAlgorithm = async (
  statementTransactions: any[],
  unreconciledTransactions: any[],
  accountId: string
) => {
  let matchedCount = 0;
  
  // For each statement transaction, try to find a matching unreconciled transaction
  for (const stmtTxn of statementTransactions) {
    // Try to match by amount and date proximity
    const matches = unreconciledTransactions
      .map(tx => {
        // Determine the transaction amount relative to the account
        let txAmount = 0;
        for (const entry of tx.ledgerEntries) {
          if (entry.debitAccountId === accountId) {
            txAmount = entry.amount;
          } else if (entry.creditAccountId === accountId) {
            txAmount = -entry.amount;
          }
        }
        
        // Calculate match score based on amount, date, and description
        const amountMatch = Math.abs(txAmount - stmtTxn.amount) < 0.01; // Exact amount match
        const daysDiff = Math.abs(new Date(tx.date).getTime() - new Date(stmtTxn.date).getTime()) / (1000 * 3600 * 24);
        const dateScore = daysDiff <= 3 ? (3 - daysDiff) / 3 : 0; // Score decreases as days apart increases
        
        // Calculate similarity between descriptions
        const descSimilarity = calculateDescriptionSimilarity(
          tx.description.toLowerCase(),
          stmtTxn.description.toLowerCase()
        );
        
        // Calculate overall match score
        const score = amountMatch ? (0.7 + (0.15 * dateScore) + (0.15 * descSimilarity)) : 0;
        
        return {
          transaction: tx,
          score
        };
      })
      .filter(match => match.score > 0.7) // Only consider good matches
      .sort((a, b) => b.score - a.score); // Sort by score descending
    
    // If we have a match with high confidence, link the transactions
    if (matches.length > 0) {
      const bestMatch = matches[0];
      
      await prisma.statementTransaction.update({
        where: { id: stmtTxn.id },
        data: {
          matchedTransactionId: bestMatch.transaction.id
        }
      });
      
      // Remove the matched transaction from the unreconciled list
      const index = unreconciledTransactions.findIndex(tx => tx.id === bestMatch.transaction.id);
      if (index !== -1) {
        unreconciledTransactions.splice(index, 1);
      }
      
      matchedCount++;
    }
  }
  
  return matchedCount;
};

/**
 * Calculate similarity between two descriptions
 */
const calculateDescriptionSimilarity = (desc1: string, desc2: string) => {
  // Simple implementation using string inclusion
  if (desc1.includes(desc2) || desc2.includes(desc1)) {
    return 1;
  }
  
  // Count matching words
  const words1 = desc1.split(/\s+/);
  const words2 = desc2.split(/\s+/);
  
  let matchCount = 0;
  for (const word of words1) {
    if (word.length >= 4 && words2.includes(word)) {
      matchCount++;
    }
  }
  
  const maxWords = Math.max(words1.length, words2.length);
  return maxWords > 0 ? matchCount / maxWords : 0;
};

/**
 * Reconcile a transaction
 */
export const reconcileTransaction = async (req: Request, res: Response) => {
  try {
    const transactionId = req.params.id;
    const { statementTransactionId, statementId } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const organizationId = req.user.organizationId;
    
    if (!transactionId || !statementId) {
      return res.status(400).json({ 
        error: 'Transaction ID and statement ID are required' 
      });
    }
    
    // Verify transaction belongs to organization
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        organizationId
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Verify statement belongs to organization
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id: statementId,
        organizationId
      }
    });
    
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    // Update transaction status to RECONCILED
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'RECONCILED' }
    });
    
    // If a statement transaction ID is provided, link it
    if (statementTransactionId) {
      await prisma.statementTransaction.update({
        where: { id: statementTransactionId },
        data: { matchedTransactionId: transactionId }
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Transaction reconciled successfully'
    });
  } catch (error: any) {
    console.error('Error in reconcileTransaction controller:', error);
    return res.status(500).json({
      error: 'Failed to reconcile transaction',
      message: error.message
    });
  }
};

/**
 * Unmatch a transaction
 */
export const unmatchTransaction = async (req: Request, res: Response) => {
  try {
    const transactionId = req.params.id;
    const { statementId } = req.body;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const organizationId = req.user.organizationId;
    
    if (!transactionId || !statementId) {
      return res.status(400).json({ 
        error: 'Transaction ID and statement ID are required' 
      });
    }
    
    // Verify transaction belongs to organization
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        organizationId
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Update transaction status back to CLEARED
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'CLEARED' }
    });
    
    // Find and update any statement transactions that reference this transaction
    await prisma.statementTransaction.updateMany({
      where: {
        matchedTransactionId: transactionId,
        statementId
      },
      data: {
        matchedTransactionId: null
      }
    });
    
    return res.status(200).json({
      success: true,
      message: 'Transaction unmatched successfully'
    });
  } catch (error: any) {
    console.error('Error in unmatchTransaction controller:', error);
    return res.status(500).json({
      error: 'Failed to unmatch transaction',
      message: error.message
    });
  }
};

/**
 * Complete reconciliation
 */
export const completeReconciliation = async (req: Request, res: Response) => {
  try {
    const statementId = req.params.id;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const organizationId = req.user.organizationId;
    
    if (!statementId) {
      return res.status(400).json({ error: 'Statement ID is required' });
    }
    
    // Verify statement belongs to organization
    const statement = await prisma.reconciliationStatement.findFirst({
      where: {
        id: statementId,
        organizationId
      },
      include: {
        account: true,
        transactions: true
      }
    });
    
    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    // Calculate reconciled balance
    let reconciledBalance = 0;
    
    for (const stmtTxn of statement.transactions) {
      if (stmtTxn.matchedTransactionId) {
        // For matched transactions, we'll calculate the balance based on ledger entries
        const matchedTx = await prisma.transaction.findUnique({
          where: { id: stmtTxn.matchedTransactionId },
          include: {
            ledgerEntries: true
          }
        });
        
        if (matchedTx) {
          for (const entry of matchedTx.ledgerEntries) {
            if (entry.debitAccountId === statement.accountId) {
              reconciledBalance += entry.amount;
            } else if (entry.creditAccountId === statement.accountId) {
              reconciledBalance -= entry.amount;
            }
          }
        }
      }
    }
    
    // Check if reconciled balance matches statement ending balance
    const difference = Math.abs(reconciledBalance - statement.endingBalance);
    
    if (difference > 0.01) {
      return res.status(400).json({
        error: 'Reconciliation failed',
        message: `Reconciled balance (${reconciledBalance}) does not match statement balance (${statement.endingBalance})`,
        difference
      });
    }
    
    // Update statement status to COMPLETED
    await prisma.reconciliationStatement.update({
      where: { id: statementId },
      data: {
        status: 'COMPLETED',
        reconciledBalance
      }
    });
    
    // Update account balance
    await prisma.account.update({
      where: { id: statement.accountId },
      data: {
        balance: statement.endingBalance
      }
    });
    
    return res.status(200).json({
      success: true,
      message: 'Reconciliation completed successfully',
      reconciledBalance
    });
  } catch (error: any) {
    console.error('Error in completeReconciliation controller:', error);
    return res.status(500).json({
      error: 'Failed to complete reconciliation',
      message: error.message
    });
  }
}; 