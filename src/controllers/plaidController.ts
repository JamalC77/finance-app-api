import { Request, Response } from 'express';
import * as plaidService from '../services/plaidService';
import * as transactionService from '../services/transactionService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Create a link token for Plaid Link
 */
export const createLinkToken = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const userId = req.user.id;
    
    const linkTokenResponse = await plaidService.createLinkToken(userId);
    
    return res.status(200).json(linkTokenResponse);
  } catch (error: any) {
    console.error('Error in createLinkToken controller:', error);
    return res.status(500).json({
      error: 'Failed to create link token',
      message: error.message
    });
  }
};

/**
 * Exchange a public token for an access token
 */
export const exchangePublicToken = async (req: Request, res: Response) => {
  try {
    const { publicToken } = req.body;
    
    if (!publicToken) {
      return res.status(400).json({ error: 'Public token is required' });
    }
    
    const exchangeResponse = await plaidService.exchangePublicToken(publicToken);
    
    // In a real application, you would save the access token to your database
    // associated with the user's account
    
    return res.status(200).json({
      accessToken: exchangeResponse.access_token,
      itemId: exchangeResponse.item_id
    });
  } catch (error: any) {
    console.error('Error in exchangePublicToken controller:', error);
    return res.status(500).json({
      error: 'Failed to exchange public token',
      message: error.message
    });
  }
};

/**
 * Get accounts for a user
 */
export const getAccounts = async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }
    
    const accountsResponse = await plaidService.getAccounts(accessToken);
    
    return res.status(200).json(accountsResponse);
  } catch (error: any) {
    console.error('Error in getAccounts controller:', error);
    return res.status(500).json({
      error: 'Failed to get accounts',
      message: error.message
    });
  }
};

/**
 * Get transactions for a user
 */
export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { accessToken, startDate, endDate } = req.body;
    
    if (!accessToken || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Access token, start date, and end date are required' 
      });
    }
    
    const transactionsResponse = await plaidService.getTransactions(
      accessToken,
      startDate,
      endDate
    );
    
    return res.status(200).json(transactionsResponse);
  } catch (error: any) {
    console.error('Error in getTransactions controller:', error);
    return res.status(500).json({
      error: 'Failed to get transactions',
      message: error.message
    });
  }
};

/**
 * Remove a Plaid account
 */
export const removeAccount = async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const userId = req.user.id; // Use id instead of userId to match the JwtPayload interface
    
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' });
    }
    
    await plaidService.removeAccount(accountId, userId);
    
    return res.status(200).json({ success: true, message: 'Account removed successfully' });
  } catch (error: any) {
    console.error('Error in removeAccount controller:', error);
    return res.status(500).json({
      error: 'Failed to remove account',
      message: error.message
    });
  }
};

/**
 * Sync transactions for a user
 */
export const syncTransactions = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    const userId = req.user.id; // Use id instead of userId
    
    // Get all accounts for the user
    const accounts = await plaidService.getAccountsForUser(userId);
    
    if (accounts.length === 0) {
      return res.status(400).json({ error: 'No linked accounts found for this user' });
    }
    
    const organizationId = req.user.organizationId;
    
    // Sync transactions for each account
    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          const syncResult = await plaidService.syncTransactions(account.plaidItemId, userId, organizationId);
          return {
            accountId: account.id,
            success: true,
            added: syncResult.added,
            modified: syncResult.modified,
            removed: syncResult.removed
          };
        } catch (error: any) {
          return {
            accountId: account.id,
            success: false,
            error: error.message
          };
        }
      })
    );
    
    return res.status(200).json({ results });
  } catch (error: any) {
    console.error('Error in syncTransactions controller:', error);
    return res.status(500).json({
      error: 'Failed to sync transactions',
      message: error.message
    });
  }
};

/**
 * Categorize transactions using machine learning
 */
export const categorizeTransactions = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const organizationId = req.user.organizationId;
    
    // Get uncategorized transactions
    const uncategorizedTransactions = await prisma.transaction.findMany({
      where: {
        organizationId
      },
      take: 100 // Limit to 100 transactions at a time
    });
    
    if (uncategorizedTransactions.length === 0) {
      return res.status(200).json({ message: 'No uncategorized transactions found' });
    }
    
    const categorizedTransactions = await transactionService.categorizeTransactions(
      uncategorizedTransactions.map(transaction => transaction.id),
      organizationId
    );
    
    return res.status(200).json({
      success: true,
      categorizedCount: categorizedTransactions.length,
      transactions: categorizedTransactions
    });
  } catch (error: any) {
    console.error('Error in categorizeTransactions controller:', error);
    return res.status(500).json({
      error: 'Failed to categorize transactions',
      message: error.message
    });
  }
};

/**
 * Handle Plaid webhooks for real-time updates
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const { webhook_type, webhook_code, item_id } = req.body;
    
    console.log(`Received webhook: ${webhook_type} - ${webhook_code} for item ${item_id}`);
    
    switch(webhook_type) {
      case 'TRANSACTIONS':
        switch(webhook_code) {
          case 'INITIAL_UPDATE':
          case 'HISTORICAL_UPDATE':
          case 'DEFAULT_UPDATE':
            // Queue a job to sync transactions for this item
            await plaidService.queueTransactionSync(item_id);
            break;
          case 'TRANSACTIONS_REMOVED':
            // Handle removed transactions
            const { removed_transactions } = req.body;
            await transactionService.handleRemovedTransactions(removed_transactions);
            break;
        }
        break;
      
      // Handle other webhook types (AUTH, ITEM, etc.)
      default:
        console.log(`Unhandled webhook type: ${webhook_type}`);
    }
    
    // Acknowledge receipt of webhook
    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Error in handleWebhook controller:', error);
    // Still return 200 to acknowledge receipt
    return res.status(200).json({ received: true });
  }
}; 