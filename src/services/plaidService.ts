import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { env } from '../utils/env';

// Create and configure the Plaid client using environment variables
const configuration = new Configuration({
  basePath: PlaidEnvironments[env.PLAID.ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': env.PLAID.CLIENT_ID,
      'PLAID-SECRET': env.PLAID.SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

/**
 * Create a link token for a user
 */
export async function createLinkToken(userId: string) {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: 'Finance App',
      products: ['transactions' as Products],
      country_codes: ['US' as CountryCode],
      language: 'en',
    });

    return response.data;
  } catch (error) {
    console.error('Error creating link token:', error);
    throw error;
  }
}

/**
 * Exchange a public token for an access token
 */
export async function exchangePublicToken(publicToken: string) {
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    return response.data;
  } catch (error) {
    console.error('Error exchanging public token:', error);
    throw error;
  }
}

/**
 * Get accounts for a user
 */
export async function getAccounts(accessToken: string) {
  try {
    const response = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting accounts:', error);
    throw error;
  }
}

/**
 * Get transactions for a user
 */
export async function getTransactions(
  accessToken: string, 
  startDate: string, 
  endDate: string
) {
  try {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    });
    
    return response.data;
  } catch (error) {
    console.error('Error getting transactions:', error);
    throw error;
  }
}

/**
 * Remove an account for a user
 * 
 * Note: This is a placeholder implementation. In a real application,
 * this would interact with your database to remove the account.
 */
export async function removeAccount(accountId: string, userId: string) {
  try {
    // This is a placeholder. In a real application, you would:
    // 1. Find the account in the database
    // 2. Check if it belongs to the user
    // 3. Remove it from the database
    
    console.log(`Removing account ${accountId} for user ${userId}`);
    
    // For development purposes, just return success
    return { success: true };
  } catch (error) {
    console.error('Error removing account:', error);
    throw error;
  }
}

/**
 * Get all accounts for a user
 * 
 * Note: This is a placeholder implementation. In a real application,
 * this would query your database for all accounts associated with the user.
 */
export async function getAccountsForUser(userId: string) {
  try {
    // This is a placeholder. In a real application, you would:
    // 1. Query the database for all accounts associated with the user
    // 2. Return the accounts
    
    console.log(`Getting accounts for user ${userId}`);
    
    // For development purposes, return mock data with the required structure
    return [
      {
        id: 'mock-account-id-1',
        plaidItemId: 'mock-plaid-item-id-1',
        name: 'Mock Checking Account',
        type: 'checking'
      }
    ];
  } catch (error) {
    console.error('Error getting accounts for user:', error);
    throw error;
  }
}

/**
 * Queue a transaction sync job for a specific Plaid item
 * @param itemId The Plaid item ID to sync transactions for
 */
export async function queueTransactionSync(itemId: string) {
  try {
    console.log(`Queuing transaction sync for item: ${itemId}`);
    // In a production environment, this would typically add a job to a queue
    // For now, we'll just log the request
    // TODO: Implement actual queuing mechanism or direct sync
    return { success: true };
  } catch (error) {
    console.error('Error queuing transaction sync:', error);
    throw error;
  }
}

/**
 * Sync transactions for a specific Plaid item
 * @param plaidItemId The Plaid item ID to sync transactions for
 * @param userId The user ID who owns the item
 * @param organizationId The organization ID associated with the user
 * @returns Object containing added, modified, and removed transactions
 */
export async function syncTransactions(plaidItemId: string, userId: string, organizationId: string) {
  try {
    console.log(`Syncing transactions for item: ${plaidItemId}, user: ${userId}, organization: ${organizationId}`);
    
    // This is a placeholder implementation
    // In a real application, you would:
    // 1. Retrieve the access token for the Plaid item from your database
    // 2. Use the Plaid API to get new transactions since the last sync
    // 3. Store those transactions in your database
    
    // For development purposes, just return a mock result
    return {
      added: 0,
      modified: 0,
      removed: 0
    };
  } catch (error) {
    console.error('Error syncing transactions:', error);
    throw error;
  }
} 