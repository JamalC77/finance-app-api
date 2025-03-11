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

      // Process each account
      let processedCount = 0;
      for (const qbAccount of qbAccounts) {
        await this.processAccount(organizationId, realmId, qbAccount);
        processedCount++;
      }

      return processedCount;
    } catch (error: any) {
      console.error('Error syncing accounts:', error);
      throw new ApiError(500, `Failed to sync accounts: ${error.message}`);
    }
  }

  /**
   * Process a single QuickBooks account
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param qbAccount The QuickBooks account
   */
  private async processAccount(organizationId: string, realmId: string, qbAccount: any): Promise<void> {
    try {
      // Check if we already have a mapping for this account
      const existingMapping = await prisma.quickbooksAccountMapping.findFirst({
        where: {
          connection: {
            organizationId,
            realmId
          },
          quickbooksId: qbAccount.Id
        },
        include: {
          account: true,
          connection: true
        }
      });

      // If we have a mapping, update the account
      if (existingMapping) {
        await this.updateExistingAccount(existingMapping.account.id, qbAccount);
        return;
      }

      // If no mapping exists, create a new account
      await this.createNewAccount(organizationId, realmId, qbAccount);
    } catch (error) {
      console.error(`Error processing account ${qbAccount.Id}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing account with QuickBooks data
   * 
   * @param accountId The local account ID
   * @param qbAccount The QuickBooks account
   */
  private async updateExistingAccount(accountId: string, qbAccount: any): Promise<void> {
    // Map QuickBooks account type to application account type
    const accountType = this.mapAccountType(qbAccount.AccountType);
    
    // Update the account
    await prisma.account.update({
      where: { id: accountId },
      data: {
        name: qbAccount.Name,
        description: qbAccount.Description,
        isActive: qbAccount.Active,
        // Map other fields as needed
      }
    });
  }

  /**
   * Create a new account from QuickBooks data
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param qbAccount The QuickBooks account
   */
  private async createNewAccount(organizationId: string, realmId: string, qbAccount: any): Promise<void> {
    // Map QuickBooks account type to application account type
    const accountType = this.mapAccountType(qbAccount.AccountType);
    
    // Generate a code for the account if not provided
    const code = qbAccount.AcctNum || `QB-${qbAccount.Id}`;
    
    // Create the account in our system
    const newAccount = await prisma.account.create({
      data: {
        name: qbAccount.Name,
        code,
        type: accountType,
        subtype: qbAccount.AccountSubType,
        description: qbAccount.Description,
        isActive: qbAccount.Active,
        balance: parseFloat(qbAccount.CurrentBalance || '0'),
        organization: {
          connect: { id: organizationId }
        }
      }
    });

    // Create a mapping between QuickBooks account and our account
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      throw new ApiError(404, 'QuickBooks connection not found');
    }

    await prisma.quickbooksAccountMapping.create({
      data: {
        quickbooksId: qbAccount.Id,
        localAccountId: newAccount.id,
        connectionId: connection.id
      }
    });
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