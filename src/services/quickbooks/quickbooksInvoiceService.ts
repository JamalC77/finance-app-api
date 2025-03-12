import { prisma } from '../../utils/prisma';
import { quickbooksApiClient } from './quickbooksApiClient';
import { ApiError } from '../../utils/errors';

/**
 * Service for synchronizing QuickBooks invoices with the application
 */
export class QuickbooksInvoiceService {
  /**
   * Sync invoices from QuickBooks to the application
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of invoices processed
   */
  async syncInvoices(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch all invoices from QuickBooks (last 90 days by default)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const formattedDate = ninetyDaysAgo.toISOString().split('T')[0];
      
      const query = `SELECT * FROM Invoice WHERE TxnDate >= '${formattedDate}' ORDER BY Id`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbInvoices = response.QueryResponse.Invoice || [];

      console.log(`Found ${qbInvoices.length} invoices in QuickBooks (from ${formattedDate})`);

      // For this simplified implementation, we'll just log the invoices
      // rather than creating them in the database
      console.log(`Would process ${qbInvoices.length} invoices`);
      
      return qbInvoices.length;
    } catch (error) {
      console.error('Error syncing invoices:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to sync invoices: ${errorMessage}`);
    }
  }

  /**
   * Map QuickBooks invoice status to application status
   * 
   * @param qbBalance QuickBooks invoice balance
   * @param qbTotal QuickBooks invoice total
   * @returns Mapped invoice status
   */
  private mapInvoiceStatus(qbBalance: string, qbTotal: string): 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' {
    const balance = parseFloat(qbBalance || '0');
    const total = parseFloat(qbTotal || '0');
    
    if (balance <= 0 && total > 0) {
      return 'PAID';
    } else if (balance === total) {
      return 'SENT';
    } else if (balance > 0 && balance < total) {
      return 'SENT'; // Partially paid, but we don't have a specific status for this
    } else {
      return 'SENT'; // Default to SENT
    }
  }
}

// Export singleton instance
export const quickbooksInvoiceService = new QuickbooksInvoiceService(); 