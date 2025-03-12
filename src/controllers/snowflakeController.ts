import { prisma } from '../utils/prisma';
import { snowflakeService } from '../services/snowflake/snowflakeService';
import { ApiError } from '../utils/errors';

/**
 * Controller for managing Snowflake data exports
 */
export class SnowflakeController {
  /**
   * Initialize Snowflake for an organization
   * 
   * @param organizationId The organization ID
   */
  async initializeForOrganization(organizationId: string): Promise<void> {
    try {
      await snowflakeService.initializeForOrganization(organizationId);
    } catch (error) {
      console.error('Error initializing Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to initialize Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Export all data for an organization to Snowflake
   * 
   * @param organizationId The organization ID
   * @returns Object with counts of exported records
   */
  async exportAllData(organizationId: string): Promise<{
    transactions: number;
    accounts: number;
    invoices: number;
    contacts: number;
  }> {
    try {
      return await snowflakeService.exportAllData(organizationId);
    } catch (error) {
      console.error('Error exporting data to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export data to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Get Snowflake export status for an organization
   * 
   * @param organizationId The organization ID
   * @returns Export status information
   */
  async getExportStatus(organizationId: string): Promise<any> {
    try {
      // Get the most recent export log
      const latestExport = await prisma.directExportLog.findFirst({
        where: {
          organizationId
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return latestExport;
    } catch (error) {
      console.error('Error getting Snowflake export status:', error);
      throw new Error('Failed to get export status');
    }
  }

  /**
   * Create a data export log entry
   * 
   * @param organizationId The organization ID
   * @param status The export status
   * @param counts Record counts by entity type
   * @param errorMessage Optional error message
   */
  async createExportLog(
    organizationId: string,
    status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS',
    counts?: {
      transactions: number;
      accounts: number;
      invoices: number;
      contacts: number;
    },
    errorMessage?: string
  ): Promise<void> {
    try {
      await prisma.directExportLog.create({
        data: {
          organizationId,
          status,
          startedAt: new Date(),
          completedAt: status === 'COMPLETED' ? new Date() : null,
          transactionsCount: counts?.transactions || 0,
          accountsCount: counts?.accounts || 0,
          invoicesCount: counts?.invoices || 0,
          contactsCount: counts?.contacts || 0,
          errorMessage,
        }
      });
    } catch (error) {
      console.error('Error creating Snowflake export log:', error);
      // Don't throw here, as this is a non-critical operation
    }
  }
}

// Export singleton instance
export const snowflakeController = new SnowflakeController(); 