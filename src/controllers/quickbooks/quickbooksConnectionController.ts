import { prisma } from '../../utils/prisma';
import { quickbooksAuthService } from '../../services/quickbooks/quickbooksAuthService';
import { ApiError } from '../../utils/errors';

/**
 * Controller for managing QuickBooks connections
 */
export class QuickbooksConnectionController {
  /**
   * Get the QuickBooks connection for an organization
   * 
   * @param organizationId The organization ID
   * @returns Connection details (with sensitive data removed)
   */
  async getConnection(organizationId: string): Promise<any> {
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      return { connected: false };
    }

    // Return connection without sensitive data
    return {
      connected: connection.isActive,
      realmId: connection.realmId,
      lastSyncedAt: connection.lastSyncedAt,
      syncFrequency: connection.syncFrequency,
      syncSettings: connection.syncSettings,
      createdAt: connection.createdAt,
      tokenExpiresAt: connection.tokenExpiresAt
    };
  }

  /**
   * Update connection settings
   * 
   * @param organizationId The organization ID
   * @param syncFrequency How often to sync data
   * @param syncSettings Additional sync settings
   * @returns Updated connection
   */
  async updateSettings(organizationId: string, syncFrequency?: string, syncSettings?: any): Promise<any> {
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      throw new ApiError(404, 'QuickBooks connection not found');
    }

    const updateData: any = {};

    if (syncFrequency) {
      const validFrequencies = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL'];
      if (!validFrequencies.includes(syncFrequency)) {
        throw new ApiError(400, `Invalid sync frequency. Must be one of: ${validFrequencies.join(', ')}`);
      }
      updateData.syncFrequency = syncFrequency;
    }

    if (syncSettings) {
      updateData.syncSettings = syncSettings;
    }

    const updatedConnection = await prisma.quickbooksConnection.update({
      where: { organizationId },
      data: updateData
    });

    // Return connection without sensitive data
    return {
      connected: updatedConnection.isActive,
      realmId: updatedConnection.realmId,
      lastSyncedAt: updatedConnection.lastSyncedAt,
      syncFrequency: updatedConnection.syncFrequency,
      syncSettings: updatedConnection.syncSettings,
      createdAt: updatedConnection.createdAt,
      tokenExpiresAt: updatedConnection.tokenExpiresAt
    };
  }

  /**
   * Disconnect from QuickBooks
   * 
   * @param organizationId The organization ID
   */
  async disconnect(organizationId: string): Promise<void> {
    try {
      await quickbooksAuthService.disconnect(organizationId);
    } catch (error) {
      console.error(`Error disconnecting from QuickBooks API for org ${organizationId}:`, error);
      // Continue with the disconnect even if API call fails
    }

    // Update connection status in the database
    await prisma.quickbooksConnection.update({
      where: { organizationId },
      data: { isActive: false }
    });
  }

  /**
   * Check if a QuickBooks connection exists and is active
   * 
   * @param organizationId The organization ID
   * @returns True if connection exists and is active
   */
  async hasActiveConnection(organizationId: string): Promise<boolean> {
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    return !!(connection && connection.isActive);
  }
}

// Export singleton instance
export const quickbooksConnectionController = new QuickbooksConnectionController(); 