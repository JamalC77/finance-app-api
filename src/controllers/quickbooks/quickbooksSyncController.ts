import { prisma } from '../../utils/prisma';
import { quickbooksApiClient } from '../../services/quickbooks/quickbooksApiClient';
import { quickbooksAccountService } from '../../services/quickbooks/quickbooksAccountService';
import { quickbooksContactService } from '../../services/quickbooks/quickbooksContactService';
// import { quickbooksInvoiceService } from '../../services/quickbooks/quickbooksInvoiceService';
// import { quickbooksTransactionService } from '../../services/quickbooks/quickbooksTransactionService';
import { ApiError } from '../../utils/errors';

/**
 * Controller for managing QuickBooks data synchronization
 */
export class QuickbooksSyncController {
  /**
   * Start a full sync of all entities from QuickBooks
   * 
   * @param organizationId The organization ID
   */
  async startFullSync(organizationId: string): Promise<void> {
    // Verify connection exists and is active
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection || !connection.isActive) {
      throw new ApiError(400, 'No active QuickBooks connection');
    }

    // Create a master sync log
    const masterSyncLog = await prisma.syncLog.create({
      data: {
        connectionId: connection.id,
        entityType: 'ALL',
        status: 'IN_PROGRESS',
      }
    });

    try {
      // Sync all entity types in order - accounts first since other entities depend on them
      await this.syncEntity(organizationId, 'accounts');
      await this.syncEntity(organizationId, 'contacts');
      await this.syncEntity(organizationId, 'invoices');
      await this.syncEntity(organizationId, 'transactions');

      // Update the master sync log
      await prisma.syncLog.update({
        where: { id: masterSyncLog.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });

      // Update the connection's lastSyncedAt timestamp
      await prisma.quickbooksConnection.update({
        where: { organizationId },
        data: { lastSyncedAt: new Date() }
      });
    } catch (error: any) {
      // Update the master sync log with error
      await prisma.syncLog.update({
        where: { id: masterSyncLog.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error.message || 'Sync failed'
        }
      });
      
      throw error;
    }
  }

  /**
   * Sync a specific entity type from QuickBooks
   * 
   * @param organizationId The organization ID
   * @param entityType The entity type to sync
   */
  async syncEntity(organizationId: string, entityType: string): Promise<void> {
    // Verify connection exists and is active
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection || !connection.isActive) {
      throw new ApiError(400, 'No active QuickBooks connection');
    }

    // Create a sync log for this entity
    const syncLog = await prisma.syncLog.create({
      data: {
        connectionId: connection.id,
        entityType,
        status: 'IN_PROGRESS',
      }
    });

    try {
      let recordsProcessed = 0;

      // Sync the specified entity type
      if (entityType === 'accounts') {
        recordsProcessed = await quickbooksAccountService.syncAccounts(organizationId, connection.realmId);
      } else if (entityType === 'contacts') {
        recordsProcessed = await quickbooksContactService.syncContacts(organizationId, connection.realmId);
      } else if (entityType === 'invoices') {
        // Commented out since the service doesn't exist yet
        // recordsProcessed = await quickbooksInvoiceService.syncInvoices(organizationId, connection.realmId);
        recordsProcessed = 0; // Placeholder
      } else if (entityType === 'transactions') {
        // Commented out since the service doesn't exist yet
        // recordsProcessed = await quickbooksTransactionService.syncTransactions(organizationId, connection.realmId);
        recordsProcessed = 0; // Placeholder
      }

      // Update sync log with completion status
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          recordsProcessed
        }
      });
    } catch (error: any) {
      // Update sync log with error
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error.message || 'Sync failed'
        }
      });
      
      throw error;
    }
  }

  /**
   * Get the current sync status for an organization
   * 
   * @param organizationId The organization ID
   * @returns Current sync status
   */
  async getSyncStatus(organizationId: string): Promise<any> {
    // Get connection info
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      throw new ApiError(404, 'QuickBooks connection not found');
    }

    // Get the most recent sync logs
    const latestSyncLogs = await prisma.syncLog.findMany({
      where: { connectionId: connection.id },
      orderBy: { startedAt: 'desc' },
      take: 5
    });

    // Check if there's an active sync
    const activeSyncs = latestSyncLogs.filter(log => log.status === 'IN_PROGRESS');
    const isActive = activeSyncs.length > 0;

    return {
      isActive,
      lastSyncedAt: connection.lastSyncedAt,
      currentSyncs: activeSyncs,
      recentCompletedSyncs: latestSyncLogs.filter(log => log.status !== 'IN_PROGRESS')
    };
  }

  /**
   * Get sync history for an organization
   * 
   * @param organizationId The organization ID
   * @param limit Maximum number of records to return
   * @returns Sync history
   */
  async getSyncHistory(organizationId: string, limit: number = 10): Promise<any> {
    // Get connection info
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      throw new ApiError(404, 'QuickBooks connection not found');
    }

    // Get sync logs
    const syncLogs = await prisma.syncLog.findMany({
      where: { connectionId: connection.id },
      orderBy: { startedAt: 'desc' },
      take: limit
    });

    return syncLogs;
  }
}

// Export singleton instance
export const quickbooksSyncController = new QuickbooksSyncController(); 