import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';
import { quickbooksAuthService } from '../../services/quickbooks/quickbooksAuthService';
import { quickbooksToSnowflakeService } from '../../services/quickbooks/quickbooksToSnowflakeService';
import { snowflakeService } from '../../services/snowflake/snowflakeService';

/**
 * Controller for handling direct QuickBooks to Snowflake exports
 */
class QuickbooksToSnowflakeController {
  /**
   * Start a direct export of all data from QuickBooks to Snowflake
   * 
   * @param organizationId The organization ID
   * @returns Promise that resolves when the export is started
   */
  async startDirectExport(organizationId: string): Promise<void> {
    try {
      // Check if Snowflake is configured
      if (!process.env.SNOWFLAKE_ACCOUNT || !process.env.SNOWFLAKE_USERNAME || !process.env.SNOWFLAKE_PASSWORD) {
        throw new ApiError(500, 'Snowflake is not properly configured');
      }

      // Get the QuickBooks connection
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection || !connection.isActive) {
        throw new ApiError(400, 'No active QuickBooks connection found');
      }

      // Create a direct export log entry with IN_PROGRESS status
      try {
        await prisma.directExportLog.create({
          data: {
            organizationId,
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          }
        });
      } catch (logError) {
        console.warn('Could not create DirectExportLog entry:', logError);
        // Continue with the export even if logging fails
      }

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);

      // Start the export process
      const exportCounts = await quickbooksToSnowflakeService.exportAllData(organizationId, connection.realmId);

      // Update the export log with success status
      try {
        await prisma.directExportLog.updateMany({
          where: {
            organizationId,
            status: 'IN_PROGRESS'
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            accountsCount: exportCounts.accounts,
            transactionsCount: exportCounts.transactions,
            invoicesCount: exportCounts.invoices,
            contactsCount: exportCounts.contacts,
          }
        });
      } catch (logError) {
        console.warn('Could not update DirectExportLog entry:', logError);
        // Continue even if logging fails
      }
    } catch (error) {
      console.error('Error in direct export:', error);
      
      // Update the export log with error status
      try {
        await prisma.directExportLog.updateMany({
          where: {
            organizationId,
            status: 'IN_PROGRESS'
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      } catch (logError) {
        console.warn('Could not update DirectExportLog entry with error status:', logError);
        // Continue even if logging fails
      }

      throw error;
    }
  }

  /**
   * Export a specific entity type directly from QuickBooks to Snowflake
   * 
   * @param organizationId The organization ID
   * @param entityType The entity type to export (accounts, transactions, invoices, contacts)
   * @returns Promise that resolves when the export is started
   */
  async exportEntityDirectly(organizationId: string, entityType: string): Promise<void> {
    try {
      // Check if Snowflake is configured
      if (!process.env.SNOWFLAKE_ACCOUNT || !process.env.SNOWFLAKE_USERNAME || !process.env.SNOWFLAKE_PASSWORD) {
        throw new ApiError(500, 'Snowflake is not properly configured');
      }

      // Get the QuickBooks connection
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection || !connection.isActive) {
        throw new ApiError(400, 'No active QuickBooks connection found');
      }

      // Create a direct export log entry with IN_PROGRESS status
      try {
        await prisma.directExportLog.create({
          data: {
            organizationId,
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            entityType
          }
        });
      } catch (logError) {
        console.warn('Could not create DirectExportLog entry:', logError);
        // Continue with the export even if logging fails
      }

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);

      // Export the specific entity type
      let count = 0;
      switch (entityType) {
        case 'accounts':
          count = await quickbooksToSnowflakeService.exportAccounts(organizationId, connection.realmId);
          break;
        case 'transactions':
          count = await quickbooksToSnowflakeService.exportTransactions(organizationId, connection.realmId);
          break;
        case 'invoices':
          count = await quickbooksToSnowflakeService.exportInvoices(organizationId, connection.realmId);
          break;
        case 'contacts':
          count = await quickbooksToSnowflakeService.exportContacts(organizationId, connection.realmId);
          break;
        default:
          throw new ApiError(400, 'Invalid entity type');
      }

      // Update the export log with success status
      try {
        await prisma.directExportLog.updateMany({
          where: {
            organizationId,
            status: 'IN_PROGRESS'
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            ...(entityType === 'accounts' && { accountsCount: count }),
            ...(entityType === 'transactions' && { transactionsCount: count }),
            ...(entityType === 'invoices' && { invoicesCount: count }),
            ...(entityType === 'contacts' && { contactsCount: count }),
          }
        });
      } catch (logError) {
        console.warn('Could not update DirectExportLog entry:', logError);
        // Continue even if logging fails
      }
    } catch (error) {
      console.error(`Error in direct ${entityType} export:`, error);
      
      // Update the export log with error status
      try {
        await prisma.directExportLog.updateMany({
          where: {
            organizationId,
            status: 'IN_PROGRESS'
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      } catch (logError) {
        console.warn('Could not update DirectExportLog entry with error status:', logError);
        // Continue even if logging fails
      }

      throw error;
    }
  }

  /**
   * Get the status of the most recent direct export
   * 
   * @param organizationId The organization ID
   * @returns The export status
   */
  async getDirectExportStatus(organizationId: string): Promise<any> {
    try {
      let latestExport;
      
      try {
        latestExport = await prisma.directExportLog.findFirst({
          where: { organizationId },
          orderBy: { startedAt: 'desc' }
        });
      } catch (error) {
        console.warn('Error fetching DirectExportLog:', error);
        // If there's an error (like table doesn't exist), return a default response
        return {
          success: true,
          data: {
            status: 'NONE',
            message: 'No direct exports have been performed or export log is unavailable'
          }
        };
      }

      if (!latestExport) {
        return {
          success: true,
          data: {
            status: 'NONE',
            message: 'No direct exports have been performed'
          }
        };
      }

      return {
        success: true,
        data: {
          status: latestExport.status,
          startedAt: latestExport.startedAt,
          completedAt: latestExport.completedAt,
          entityType: latestExport.entityType,
          accountsCount: latestExport.accountsCount,
          transactionsCount: latestExport.transactionsCount,
          invoicesCount: latestExport.invoicesCount,
          contactsCount: latestExport.contactsCount,
          errorMessage: latestExport.errorMessage
        }
      };
    } catch (error) {
      console.error('Error getting direct export status:', error);
      throw error;
    }
  }

  /**
   * Get the history of direct exports
   * 
   * @param organizationId The organization ID
   * @param limit The maximum number of records to return
   * @returns The export history
   */
  async getDirectExportHistory(organizationId: string, limit: number = 10): Promise<any> {
    try {
      let exports = [];
      
      try {
        exports = await prisma.directExportLog.findMany({
          where: { organizationId },
          orderBy: { startedAt: 'desc' },
          take: limit
        });
      } catch (error) {
        console.warn('Error fetching DirectExportLog history:', error);
        // If there's an error (like table doesn't exist), return an empty array
        return {
          success: true,
          data: []
        };
      }

      return {
        success: true,
        data: exports
      };
    } catch (error) {
      console.error('Error getting direct export history:', error);
      throw error;
    }
  }
}

export const quickbooksToSnowflakeController = new QuickbooksToSnowflakeController(); 