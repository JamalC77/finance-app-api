import { prisma } from '../../utils/prisma';
import { quickbooksApiClient } from './quickbooksApiClient';
import { ApiError } from '../../utils/errors';

/**
 * Service for synchronizing QuickBooks customers and vendors with application contacts
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
      // First sync customers
      const customersProcessed = await this.syncCustomers(organizationId, realmId);
      
      // Then sync vendors
      const vendorsProcessed = await this.syncVendors(organizationId, realmId);
      
      return customersProcessed + vendorsProcessed;
    } catch (error: any) {
      console.error('Error syncing contacts:', error);
      throw new ApiError(500, `Failed to sync contacts: ${error.message}`);
    }
  }

  /**
   * Sync customers from QuickBooks
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

      // Process each customer
      let processedCount = 0;
      for (const qbCustomer of qbCustomers) {
        await this.processCustomer(organizationId, realmId, qbCustomer);
        processedCount++;
      }

      return processedCount;
    } catch (error) {
      console.error('Error syncing customers:', error);
      throw error;
    }
  }

  /**
   * Sync vendors from QuickBooks
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

      // Process each vendor
      let processedCount = 0;
      for (const qbVendor of qbVendors) {
        await this.processVendor(organizationId, realmId, qbVendor);
        processedCount++;
      }

      return processedCount;
    } catch (error) {
      console.error('Error syncing vendors:', error);
      throw error;
    }
  }

  /**
   * Process a single QuickBooks customer
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param qbCustomer The QuickBooks customer
   */
  private async processCustomer(organizationId: string, realmId: string, qbCustomer: any): Promise<void> {
    try {
      // Check if we already have a mapping for this customer
      const existingMapping = await prisma.quickbooksContactMapping.findFirst({
        where: {
          connection: {
            organizationId,
            realmId
          },
          quickbooksId: qbCustomer.Id
        },
        include: {
          contact: true,
          connection: true
        }
      });

      // If we have a mapping, update the contact
      if (existingMapping) {
        await this.updateExistingContact(existingMapping.contact.id, qbCustomer, 'CUSTOMER');
        return;
      }

      // If no mapping exists, create a new contact
      await this.createNewContact(organizationId, realmId, qbCustomer, 'CUSTOMER');
    } catch (error) {
      console.error(`Error processing customer ${qbCustomer.Id}:`, error);
      throw error;
    }
  }

  /**
   * Process a single QuickBooks vendor
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param qbVendor The QuickBooks vendor
   */
  private async processVendor(organizationId: string, realmId: string, qbVendor: any): Promise<void> {
    try {
      // Check if we already have a mapping for this vendor
      const existingMapping = await prisma.quickbooksContactMapping.findFirst({
        where: {
          connection: {
            organizationId,
            realmId
          },
          quickbooksId: qbVendor.Id
        },
        include: {
          contact: true,
          connection: true
        }
      });

      // If we have a mapping, update the contact
      if (existingMapping) {
        await this.updateExistingContact(existingMapping.contact.id, qbVendor, 'VENDOR');
        return;
      }

      // If no mapping exists, create a new contact
      await this.createNewContact(organizationId, realmId, qbVendor, 'VENDOR');
    } catch (error) {
      console.error(`Error processing vendor ${qbVendor.Id}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing contact with QuickBooks data
   * 
   * @param contactId The local contact ID
   * @param qbEntity The QuickBooks entity (customer or vendor)
   * @param contactType The contact type
   */
  private async updateExistingContact(contactId: string, qbEntity: any, contactType: 'CUSTOMER' | 'VENDOR'): Promise<void> {
    // Extract contact data based on entity type
    const { name, email, phone, address } = this.extractContactData(qbEntity, contactType);
    
    // Update the contact
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        name,
        email,
        phone,
        address: address?.Line1,
        city: address?.City,
        state: address?.CountrySubDivisionCode,
        zip: address?.PostalCode,
        country: address?.Country,
        isActive: true,
      }
    });
  }

  /**
   * Create a new contact from QuickBooks data
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @param qbEntity The QuickBooks entity (customer or vendor)
   * @param contactType The contact type
   */
  private async createNewContact(organizationId: string, realmId: string, qbEntity: any, contactType: 'CUSTOMER' | 'VENDOR'): Promise<void> {
    // Extract contact data based on entity type
    const { name, email, phone, address } = this.extractContactData(qbEntity, contactType);
    
    // Create the contact in our system
    const newContact = await prisma.contact.create({
      data: {
        name,
        type: contactType === 'CUSTOMER' ? 'CUSTOMER' : 'VENDOR',
        email,
        phone,
        address: address?.Line1,
        city: address?.City,
        state: address?.CountrySubDivisionCode,
        zip: address?.PostalCode,
        country: address?.Country,
        taxIdentifier: qbEntity.TaxIdentifier,
        isActive: true,
        organization: {
          connect: { id: organizationId }
        }
      }
    });

    // Create a mapping between QuickBooks entity and our contact
    const connection = await prisma.quickbooksConnection.findUnique({
      where: { organizationId }
    });

    if (!connection) {
      throw new ApiError(404, 'QuickBooks connection not found');
    }

    await prisma.quickbooksContactMapping.create({
      data: {
        quickbooksId: qbEntity.Id,
        localContactId: newContact.id,
        connectionId: connection.id
      }
    });
  }

  /**
   * Extract contact data from QuickBooks entity
   * 
   * @param qbEntity The QuickBooks entity (customer or vendor)
   * @param contactType The contact type
   * @returns Extracted contact data
   */
  private extractContactData(qbEntity: any, contactType: 'CUSTOMER' | 'VENDOR'): any {
    let name = '';
    let email = '';
    let phone = '';
    let address = null;

    if (contactType === 'CUSTOMER') {
      // Customer-specific extraction
      name = qbEntity.DisplayName || qbEntity.CompanyName || '';
      email = qbEntity.PrimaryEmailAddr?.Address || '';
      phone = qbEntity.PrimaryPhone?.FreeFormNumber || '';
      address = qbEntity.BillAddr || qbEntity.ShipAddr;
    } else {
      // Vendor-specific extraction
      name = qbEntity.DisplayName || qbEntity.CompanyName || '';
      email = qbEntity.PrimaryEmailAddr?.Address || '';
      phone = qbEntity.PrimaryPhone?.FreeFormNumber || '';
      address = qbEntity.BillAddr;
    }

    return { name, email, phone, address };
  }
}

// Export singleton instance
export const quickbooksContactService = new QuickbooksContactService(); 