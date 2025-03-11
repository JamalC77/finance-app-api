import { PrismaClient, BankConnection } from '@prisma/client';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import * as natural from 'natural';
import { v4 as uuidv4 } from 'uuid';

// Define a Transaction interface to replace the missing Prisma Transaction type
interface Transaction {
  id: string;
  accountId: string;
  userId: string;
  organizationId: string;
  bankTransactionId?: string | null;
  name: string;
  amount: number;
  date: Date;
  category?: string | null;
  description?: string | null;
  pending: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const prisma = new PrismaClient();
const classifier = new natural.BayesClassifier();

// Initialize the classifier with some basic categories
// In a real app, this would be trained on user data or use a pre-trained model
const initializeClassifier = () => {
  // Banking/Income categories
  classifier.addDocument('salary', 'INCOME');
  classifier.addDocument('paycheck', 'INCOME');
  classifier.addDocument('payment received', 'INCOME');
  classifier.addDocument('deposit', 'INCOME');
  classifier.addDocument('interest', 'INCOME');
  
  // Expenses - Food
  classifier.addDocument('restaurant', 'FOOD');
  classifier.addDocument('cafe', 'FOOD');
  classifier.addDocument('grocery', 'FOOD');
  classifier.addDocument('supermarket', 'FOOD');
  
  // Expenses - Transportation
  classifier.addDocument('gas', 'TRANSPORTATION');
  classifier.addDocument('fuel', 'TRANSPORTATION');
  classifier.addDocument('uber', 'TRANSPORTATION');
  classifier.addDocument('lyft', 'TRANSPORTATION');
  classifier.addDocument('taxi', 'TRANSPORTATION');
  
  // Expenses - Housing
  classifier.addDocument('rent', 'HOUSING');
  classifier.addDocument('mortgage', 'HOUSING');
  classifier.addDocument('electricity', 'UTILITIES');
  classifier.addDocument('water', 'UTILITIES');
  classifier.addDocument('internet', 'UTILITIES');
  
  // Expenses - Entertainment
  classifier.addDocument('movie', 'ENTERTAINMENT');
  classifier.addDocument('netflix', 'ENTERTAINMENT');
  classifier.addDocument('spotify', 'ENTERTAINMENT');
  classifier.addDocument('concert', 'ENTERTAINMENT');
  
  // Train the classifier
  classifier.train();
};

// Initialize the classifier when the service is loaded
initializeClassifier();

/**
 * Sync Plaid transactions with our database
 */
export const syncPlaidTransactions = async (
  plaidTransactions: any[],
  userId: string,
  organizationId: string
) => {
  // Track the results
  const result = {
    added: 0,
    modified: 0,
    removed: 0
  };
  
  // Get organization's accounts to map Plaid account IDs to our account IDs
  const bankConnections = await prisma.bankConnection.findMany({
    where: { organizationId }
  });
  
  // Create a map of Plaid account IDs to our account IDs
  const accountMap = new Map();
  
  // Using the proper BankConnection type from Prisma
  bankConnections.forEach((connection: BankConnection) => {
    // In this version of the schema, we don't have metadata field
    // Instead, we'll use the externalId field to map to Plaid account IDs
    if (connection.externalId) {
      // For simplicity, we'll map the externalId directly to the connection id
      // In a real app, you'd need to store the mapping between Plaid account IDs and your DB account IDs
      accountMap.set(connection.externalId, connection.id);
    }
  });
  
  // Process each transaction
  for (const plaidTx of plaidTransactions) {
    const dbAccountId = accountMap.get(plaidTx.account_id);
    
    if (!dbAccountId) {
      console.warn(`No matching account found for Plaid account ID: ${plaidTx.account_id}`);
      continue;
    }
    
    // Check if transaction already exists
    const existingTx = await prisma.transaction.findFirst({
      where: {
        organizationId,
        bankTransactionId: plaidTx.transaction_id
      }
    });
    
    if (existingTx) {
      // Update existing transaction
      await prisma.transaction.update({
        where: { id: existingTx.id },
        data: {
          description: plaidTx.name,
          date: new Date(plaidTx.date),
          bankTransactionId: plaidTx.transaction_id,
          // Update other fields as needed
        }
      });
      
      result.modified++;
    } else {
      // Create new transaction
      const newTx = await prisma.transaction.create({
        data: {
          id: uuidv4(),
          organizationId,
          description: plaidTx.name,
          date: new Date(plaidTx.date),
          bankTransactionId: plaidTx.transaction_id,
          status: 'PENDING',
          reference: plaidTx.reference || '',
          // Other required fields based on the schema
        }
      });
      
      // Create ledger entries for the transaction
      /*
      if (plaidTx.amount > 0) {
        // Expense: Debit expense account, credit asset account
        await createDoubleEntry(
          newTx.id,
          null, // Will be determined by categorization
          dbAccountId,
          plaidTx.amount
        );
      } else {
        // Income: Debit asset account, credit income account
        await createDoubleEntry(
          newTx.id,
          dbAccountId,
          null, // Will be determined by categorization
          Math.abs(plaidTx.amount)
        );
      }
      */
      
      result.added++;
    }
  }
  
  return result;
};

/*
const createDoubleEntry = async (
  transactionId: string,
  debitAccountId: string | null,
  creditAccountId: string | null,
  amount: number
) => {
  await prisma.ledgerEntry.create({
    data: {
      id: uuidv4(),
      transactionId,
      debitAccountId,
      creditAccountId,
      amount
    }
  });
};
*/

/**
 * Categorize transactions using machine learning
 */
export const categorizeTransactions = async (
  transactionIds: string[],
  organizationId: string
) => {
  const transactions = await prisma.transaction.findMany({
    where: {
      id: { in: transactionIds },
      organizationId
    },
    /*
    include: {
      ledgerEntries: true
    }
    */
  });
  
  const categorizedTransactions = [];
  
  for (const transaction of transactions) {
    // Get appropriate category based on transaction description
    const category = classifier.classify(transaction.description || '');
    
    // Find the appropriate account for this category
    /*
    const account = await prisma.account.findFirst({
      where: {
        organizationId,
        subtype: category
      }
    });
    */
    
    categorizedTransactions.push({
      id: transaction.id,
      description: transaction.description,
      category
    });
  }
  
  return categorizedTransactions;
};

/**
 * Handle transactions removed from Plaid
 */
export const handleRemovedTransactions = async (removedTransactionIds: string[]) => {
  // Mark transactions as voided in our system
  await prisma.transaction.updateMany({
    where: {
      bankTransactionId: { in: removedTransactionIds }
    },
    data: {
      status: 'VOIDED'
    }
  });
  
  return { removedCount: removedTransactionIds.length };
}; 