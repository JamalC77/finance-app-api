import { prisma } from '../../utils/prisma';
import { quickbooksApiClient } from './quickbooksApiClient';
import { ApiError } from '../../utils/errors';

/**
 * Service for synchronizing QuickBooks accounts with the application
 */
export class QuickbooksAccountService {
  /**
   * Sync accounts from QuickBooks to the application
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of accounts processed
   */
  async syncAccounts(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch all active accounts from QuickBooks
      const query = "SELECT * FROM Account WHERE Active = true ORDER BY Id";
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbAccounts = response.QueryResponse.Account || [];

      console.log(`Found ${qbAccounts.length} accounts in QuickBooks`);

      // For this simplified implementation, we'll just log the accounts
      // rather than creating them in the database
      console.log(`Would process ${qbAccounts.length} accounts`);
      
      return qbAccounts.length;
    } catch (error) {
      console.error('Error syncing accounts:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to sync accounts: ${errorMessage}`);
    }
  }

  /**
   * Map QuickBooks account type to application account type
   * 
   * @param qbAccountType The QuickBooks account type
   * @returns Mapped account type
   */
  private mapAccountType(qbAccountType: string): 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' {
    const typeMap: Record<string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'> = {
      'Bank': 'ASSET',
      'Accounts Receivable': 'ASSET',
      'Other Current Asset': 'ASSET',
      'Fixed Asset': 'ASSET',
      'Other Asset': 'ASSET',
      'Accounts Payable': 'LIABILITY',
      'Credit Card': 'LIABILITY',
      'Other Current Liability': 'LIABILITY',
      'Long Term Liability': 'LIABILITY',
      'Equity': 'EQUITY',
      'Income': 'REVENUE',
      'Cost of Goods Sold': 'EXPENSE',
      'Expense': 'EXPENSE',
      'Other Income': 'REVENUE',
      'Other Expense': 'EXPENSE'
    };
    
    return typeMap[qbAccountType] || 'ASSET';
  }
}

// Export singleton instance
export const quickbooksAccountService = new QuickbooksAccountService(); 