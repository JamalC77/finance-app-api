import { prisma } from '../../utils/prisma';
import { quickbooksApiClient } from './quickbooksApiClient';
import { ApiError } from '../../utils/errors';

/**
 * Service for synchronizing QuickBooks contacts (customers and vendors) with the application
 */
export class QuickbooksContactService {
  /**
   * Sync contacts from QuickBooks to the application
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of contacts processed
   */
  async syncContacts(organizationId: string, realmId: string): Promise<number> {
    try {
      let processedCount = 0;
      
      // Sync customers
      const customerCount = await this.syncCustomers(organizationId, realmId);
      processedCount += customerCount;
      
      // Sync vendors
      const vendorCount = await this.syncVendors(organizationId, realmId);
      processedCount += vendorCount;
      
      return processedCount;
    } catch (error) {
      console.error('Error syncing contacts:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to sync contacts: ${errorMessage}`);
    }
  }

  /**
   * Sync customers from QuickBooks to the application
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of customers processed
   */
  private async syncCustomers(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch all active customers from QuickBooks
      const query = "SELECT * FROM Customer WHERE Active = true ORDER BY Id";
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbCustomers = response.QueryResponse.Customer || [];

      console.log(`Found ${qbCustomers.length} customers in QuickBooks`);
      
      // For this simplified implementation, we'll just log the customers
      // rather than creating them in the database
      console.log(`Would process ${qbCustomers.length} customers`);
      
      return qbCustomers.length;
    } catch (error) {
      console.error('Error syncing customers:', error);
      throw error;
    }
  }

  /**
   * Sync vendors from QuickBooks to the application
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of vendors processed
   */
  private async syncVendors(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch all active vendors from QuickBooks
      const query = "SELECT * FROM Vendor WHERE Active = true ORDER BY Id";
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbVendors = response.QueryResponse.Vendor || [];

      console.log(`Found ${qbVendors.length} vendors in QuickBooks`);
      
      // For this simplified implementation, we'll just log the vendors
      // rather than creating them in the database
      console.log(`Would process ${qbVendors.length} vendors`);
      
      return qbVendors.length;
    } catch (error) {
      console.error('Error syncing vendors:', error);
      throw error;
    }
  }

  /**
   * Extract name from QBO entity
   */
  private extractName(qbEntity: any, entityType: 'CUSTOMER' | 'VENDOR'): string {
    if (entityType === 'CUSTOMER') {
      if (qbEntity.DisplayName) return qbEntity.DisplayName;
      if (qbEntity.FullyQualifiedName) return qbEntity.FullyQualifiedName;
      if (qbEntity.CompanyName) return qbEntity.CompanyName;
      if (qbEntity.GivenName && qbEntity.FamilyName) {
        return `${qbEntity.GivenName} ${qbEntity.FamilyName}`;
      }
      return `Customer ${qbEntity.Id}`;
    } else {
      if (qbEntity.DisplayName) return qbEntity.DisplayName;
      if (qbEntity.CompanyName) return qbEntity.CompanyName;
      if (qbEntity.PrintOnCheckName) return qbEntity.PrintOnCheckName;
      return `Vendor ${qbEntity.Id}`;
    }
  }

  /**
   * Extract email from QBO entity
   */
  private extractEmail(qbEntity: any, entityType: 'CUSTOMER' | 'VENDOR'): string | null {
    if (qbEntity.PrimaryEmailAddr?.Address) {
      return qbEntity.PrimaryEmailAddr.Address;
    }
    return null;
  }

  /**
   * Extract phone from QBO entity
   */
  private extractPhone(qbEntity: any, entityType: 'CUSTOMER' | 'VENDOR'): string | null {
    if (qbEntity.PrimaryPhone?.FreeFormNumber) {
      return qbEntity.PrimaryPhone.FreeFormNumber;
    }
    if (qbEntity.Mobile?.FreeFormNumber) {
      return qbEntity.Mobile.FreeFormNumber;
    }
    return null;
  }

  /**
   * Extract address from QBO entity
   */
  private extractAddress(qbEntity: any, entityType: 'CUSTOMER' | 'VENDOR'): any {
    if (qbEntity.BillAddr) {
      return qbEntity.BillAddr;
    }
    if (qbEntity.ShipAddr) {
      return qbEntity.ShipAddr;
    }
    return null;
  }
}

// Export singleton instance
export const quickbooksContactService = new QuickbooksContactService(); 