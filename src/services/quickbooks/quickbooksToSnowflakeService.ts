import { quickbooksApiClient } from './quickbooksApiClient';
import { snowflakeService } from '../snowflake/snowflakeService';
import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';

/**
 * Service for directly exporting QuickBooks data to Snowflake
 * without storing it in the application database
 */
export class QuickbooksToSnowflakeService {
  /**
   * Export QuickBooks accounts directly to Snowflake
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of records exported
   */
  async exportAccounts(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch accounts from QuickBooks
      const query = 'SELECT * FROM Account WHERE Active IN (true, false) ORDER BY Id';
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbAccounts = response.QueryResponse.Account || [];

      console.log(`Found ${qbAccounts.length} accounts in QuickBooks`);
      
      if (qbAccounts.length === 0) {
        return 0;
      }

      // Transform accounts for Snowflake
      const transformedAccounts = qbAccounts.map((account: any) => {
        return {
          account_id: account.Id,
          organization_id: organizationId,
          name: account.Name,
          type: account.AccountType,
          subtype: account.AccountSubType,
          balance: account.CurrentBalance || 0,
          currency: account.CurrencyRef?.value || 'USD',
          is_active: account.Active,
          created_at: new Date().toISOString()
        };
      });

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);
      
      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'ACCOUNTS';
      
      // Clear existing data for this organization
      await snowflakeService.executeStatement(`
        DELETE FROM ${snowflakeService.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
      `);
      
      // Insert new data
      for (const account of transformedAccounts) {
        await snowflakeService.executeStatement(`
          INSERT INTO ${snowflakeService.database}.${schemaName}.${tableName} (
            ACCOUNT_ID, ORGANIZATION_ID, NAME, TYPE, SUBTYPE,
            BALANCE, CURRENCY, IS_ACTIVE, CREATED_AT, SOURCE
          ) VALUES (
            '${account.account_id}',
            '${account.organization_id}',
            '${account.name.replace(/'/g, "''")}',
            '${account.type || ''}',
            '${account.subtype || ''}',
            ${account.balance},
            '${account.currency}',
            ${account.is_active},
            '${account.created_at}',
            'QUICKBOOKS'
          )
        `);
      }

      return transformedAccounts.length;
    } catch (error) {
      console.error('Error exporting accounts to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export accounts to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Export QuickBooks transactions directly to Snowflake
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of records exported
   */
  async exportTransactions(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch transactions from QuickBooks (last 90 days by default)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const formattedDate = ninetyDaysAgo.toISOString().split('T')[0];
      
      // Use the Purchase endpoint for expenses
      const query = `SELECT * FROM Purchase WHERE TxnDate >= '${formattedDate}' ORDER BY Id`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbTransactions = response.QueryResponse.Purchase || [];

      console.log(`Found ${qbTransactions.length} purchase transactions in QuickBooks (from ${formattedDate})`);
      
      // Also get payment transactions
      const paymentQuery = `SELECT * FROM Payment WHERE TxnDate >= '${formattedDate}' ORDER BY Id`;
      const paymentResponse = await quickbooksApiClient.query(organizationId, realmId, paymentQuery);
      const qbPayments = paymentResponse.QueryResponse.Payment || [];

      console.log(`Found ${qbPayments.length} payment transactions in QuickBooks (from ${formattedDate})`);
      
      // Combine and transform transactions for Snowflake
      const transformedTransactions = [
        ...qbTransactions.map((txn: any) => this.transformTransaction(txn, organizationId, 'PURCHASE')),
        ...qbPayments.map((txn: any) => this.transformTransaction(txn, organizationId, 'PAYMENT'))
      ];
      
      if (transformedTransactions.length === 0) {
        return 0;
      }

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);
      
      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'TRANSACTIONS';
      
      // Clear existing data for this organization
      await snowflakeService.executeStatement(`
        DELETE FROM ${snowflakeService.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
        AND SOURCE = 'QUICKBOOKS'
      `);
      
      // Insert new data
      for (const transaction of transformedTransactions) {
        await snowflakeService.executeStatement(`
          INSERT INTO ${snowflakeService.database}.${schemaName}.${tableName} (
            TRANSACTION_ID, ORGANIZATION_ID, DATE, DESCRIPTION, REFERENCE,
            STATUS, AMOUNT, ACCOUNTS, CREATED_AT, YEAR, MONTH, DAY, SOURCE
          ) VALUES (
            '${transaction.transaction_id}',
            '${transaction.organization_id}',
            '${transaction.date}',
            '${transaction.description?.replace(/'/g, "''")}',
            '${transaction.reference?.replace(/'/g, "''")}',
            '${transaction.status}',
            ${transaction.amount},
            '${transaction.accounts?.replace(/'/g, "''")}',
            '${transaction.created_at}',
            ${transaction.year},
            ${transaction.month},
            ${transaction.day},
            'QUICKBOOKS'
          )
        `);
      }

      return transformedTransactions.length;
    } catch (error) {
      console.error('Error exporting transactions to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export transactions to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Export QuickBooks invoices directly to Snowflake
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of records exported
   */
  async exportInvoices(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch invoices from QuickBooks (last 90 days by default)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const formattedDate = ninetyDaysAgo.toISOString().split('T')[0];
      
      const query = `SELECT * FROM Invoice WHERE TxnDate >= '${formattedDate}' ORDER BY Id`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const qbInvoices = response.QueryResponse.Invoice || [];

      console.log(`Found ${qbInvoices.length} invoices in QuickBooks (from ${formattedDate})`);
      
      if (qbInvoices.length === 0) {
        return 0;
      }

      // Transform invoices for Snowflake
      const transformedInvoices = qbInvoices.map((invoice: any) => {
        const txnDate = new Date(invoice.TxnDate);
        return {
          invoice_id: invoice.Id,
          organization_id: organizationId,
          customer_id: invoice.CustomerRef?.value,
          customer_name: invoice.CustomerRef?.name,
          date: invoice.TxnDate,
          due_date: invoice.DueDate,
          total_amount: invoice.TotalAmt,
          balance: invoice.Balance,
          status: this.getInvoiceStatus(invoice),
          currency: invoice.CurrencyRef?.value || 'USD',
          created_at: new Date().toISOString(),
          year: txnDate.getFullYear(),
          month: txnDate.getMonth() + 1,
          day: txnDate.getDate()
        };
      });

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);
      
      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'INVOICES';
      
      // Clear existing data for this organization
      await snowflakeService.executeStatement(`
        DELETE FROM ${snowflakeService.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
      `);
      
      // Insert new data
      for (const invoice of transformedInvoices) {
        await snowflakeService.executeStatement(`
          INSERT INTO ${snowflakeService.database}.${schemaName}.${tableName} (
            INVOICE_ID, ORGANIZATION_ID, CUSTOMER_ID, CUSTOMER_NAME, DATE,
            DUE_DATE, TOTAL_AMOUNT, BALANCE, STATUS, CURRENCY, CREATED_AT,
            YEAR, MONTH, DAY, SOURCE
          ) VALUES (
            '${invoice.invoice_id}',
            '${invoice.organization_id}',
            '${invoice.customer_id || ''}',
            '${invoice.customer_name?.replace(/'/g, "''") || ''}',
            '${invoice.date}',
            '${invoice.due_date || invoice.date}',
            ${invoice.total_amount},
            ${invoice.balance},
            '${invoice.status}',
            '${invoice.currency}',
            '${invoice.created_at}',
            ${invoice.year},
            ${invoice.month},
            ${invoice.day},
            'QUICKBOOKS'
          )
        `);
      }

      return transformedInvoices.length;
    } catch (error) {
      console.error('Error exporting invoices to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export invoices to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Export QuickBooks contacts directly to Snowflake
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Number of records exported
   */
  async exportContacts(organizationId: string, realmId: string): Promise<number> {
    try {
      // Fetch customers from QuickBooks
      const customerQuery = 'SELECT * FROM Customer WHERE Active IN (true, false) ORDER BY Id';
      const customerResponse = await quickbooksApiClient.query(organizationId, realmId, customerQuery);
      const qbCustomers = customerResponse.QueryResponse.Customer || [];

      // Fetch vendors from QuickBooks
      const vendorQuery = 'SELECT * FROM Vendor WHERE Active IN (true, false) ORDER BY Id';
      const vendorResponse = await quickbooksApiClient.query(organizationId, realmId, vendorQuery);
      const qbVendors = vendorResponse.QueryResponse.Vendor || [];

      console.log(`Found ${qbCustomers.length} customers and ${qbVendors.length} vendors in QuickBooks`);
      
      // Transform contacts for Snowflake
      const transformedContacts = [
        ...qbCustomers.map((customer: any) => this.transformContact(customer, organizationId, 'CUSTOMER')),
        ...qbVendors.map((vendor: any) => this.transformContact(vendor, organizationId, 'VENDOR'))
      ];
      
      if (transformedContacts.length === 0) {
        return 0;
      }

      // Initialize Snowflake for the organization if needed
      await snowflakeService.initializeForOrganization(organizationId);
      
      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'CONTACTS';
      
      // Clear existing data for this organization
      await snowflakeService.executeStatement(`
        DELETE FROM ${snowflakeService.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
      `);
      
      // Insert new data
      for (const contact of transformedContacts) {
        await snowflakeService.executeStatement(`
          INSERT INTO ${snowflakeService.database}.${schemaName}.${tableName} (
            CONTACT_ID, ORGANIZATION_ID, NAME, TYPE, EMAIL,
            PHONE, ADDRESS, IS_ACTIVE, BALANCE, CREATED_AT, SOURCE
          ) VALUES (
            '${contact.contact_id}',
            '${contact.organization_id}',
            '${contact.name.replace(/'/g, "''")}',
            '${contact.type}',
            '${contact.email || ''}',
            '${contact.phone || ''}',
            '${contact.address?.replace(/'/g, "''") || ''}',
            ${contact.is_active},
            ${contact.balance || 0},
            '${contact.created_at}',
            'QUICKBOOKS'
          )
        `);
      }

      return transformedContacts.length;
    } catch (error) {
      console.error('Error exporting contacts to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export contacts to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Export all QuickBooks data directly to Snowflake
   * 
   * @param organizationId The organization ID
   * @param realmId The QuickBooks company ID
   * @returns Object with counts of exported records
   */
  async exportAllData(organizationId: string, realmId: string): Promise<{
    accounts: number;
    transactions: number;
    invoices: number;
    contacts: number;
  }> {
    try {
      // Export each entity type
      const accountCount = await this.exportAccounts(organizationId, realmId);
      const transactionCount = await this.exportTransactions(organizationId, realmId);
      const invoiceCount = await this.exportInvoices(organizationId, realmId);
      const contactCount = await this.exportContacts(organizationId, realmId);
      
      return {
        accounts: accountCount,
        transactions: transactionCount,
        invoices: invoiceCount,
        contacts: contactCount
      };
    } catch (error) {
      console.error('Error exporting all data to Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export all data to Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Transform a QuickBooks transaction for Snowflake
   * 
   * @param qbTransaction The QuickBooks transaction
   * @param organizationId The organization ID
   * @param txnType The transaction type
   * @returns Transformed transaction
   */
  private transformTransaction(qbTransaction: any, organizationId: string, txnType: string): any {
    const txnDate = new Date(qbTransaction.TxnDate);
    
    // Get accounts involved in the transaction
    let accounts = '';
    if (txnType === 'PURCHASE') {
      accounts = qbTransaction.AccountRef?.name || '';
    } else if (txnType === 'PAYMENT') {
      accounts = qbTransaction.DepositToAccountRef?.name || '';
    }
    
    return {
      transaction_id: qbTransaction.Id,
      organization_id: organizationId,
      date: qbTransaction.TxnDate,
      description: this.getTransactionDescription(qbTransaction, txnType),
      reference: qbTransaction.DocNumber || '',
      status: qbTransaction.PrivateNote ? 'RECONCILED' : 'UNRECONCILED',
      amount: qbTransaction.TotalAmt || 0,
      accounts: accounts,
      created_at: new Date().toISOString(),
      year: txnDate.getFullYear(),
      month: txnDate.getMonth() + 1,
      day: txnDate.getDate()
    };
  }

  /**
   * Transform a QuickBooks contact for Snowflake
   * 
   * @param qbContact The QuickBooks contact
   * @param organizationId The organization ID
   * @param contactType The contact type
   * @returns Transformed contact
   */
  private transformContact(qbContact: any, organizationId: string, contactType: string): any {
    // Format address if available
    let address = '';
    if (qbContact.BillAddr) {
      const addr = qbContact.BillAddr;
      address = [
        addr.Line1,
        addr.Line2,
        addr.City,
        addr.CountrySubDivisionCode,
        addr.PostalCode,
        addr.Country
      ].filter(Boolean).join(', ');
    }
    
    return {
      contact_id: qbContact.Id,
      organization_id: organizationId,
      name: qbContact.DisplayName || qbContact.CompanyName || '',
      type: contactType,
      email: qbContact.PrimaryEmailAddr?.Address || '',
      phone: qbContact.PrimaryPhone?.FreeFormNumber || '',
      address: address,
      is_active: qbContact.Active,
      balance: qbContact.Balance || 0,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Get a description for the transaction based on its type
   * 
   * @param qbTransaction The QuickBooks transaction
   * @param txnType The transaction type
   * @returns A formatted description
   */
  private getTransactionDescription(qbTransaction: any, txnType: string): string {
    if (txnType === 'PURCHASE') {
      // For purchases, use the vendor name if available
      const vendorName = qbTransaction.EntityRef?.name || 'Unknown Vendor';
      return `Purchase - ${vendorName}${qbTransaction.PrivateNote ? `: ${qbTransaction.PrivateNote}` : ''}`;
    } else if (txnType === 'PAYMENT') {
      // For payments, use the customer name if available
      const customerName = qbTransaction.CustomerRef?.name || 'Unknown Customer';
      return `Payment - ${customerName}${qbTransaction.PrivateNote ? `: ${qbTransaction.PrivateNote}` : ''}`;
    } else {
      // Generic description for other transaction types
      return `QuickBooks Transaction: ${qbTransaction.Id}`;
    }
  }

  /**
   * Get the status of an invoice
   * 
   * @param qbInvoice The QuickBooks invoice
   * @returns The invoice status
   */
  private getInvoiceStatus(qbInvoice: any): string {
    if (qbInvoice.Balance === 0) {
      return 'PAID';
    } else if (qbInvoice.Balance === qbInvoice.TotalAmt) {
      return 'UNPAID';
    } else {
      return 'PARTIAL';
    }
  }
}

// Export singleton instance
export const quickbooksToSnowflakeService = new QuickbooksToSnowflakeService(); 