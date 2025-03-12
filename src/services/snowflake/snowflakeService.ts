import snowflake from 'snowflake-sdk';
import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';

/**
 * Service for interacting with Snowflake for data analytics
 */
export class SnowflakeService {
  private connection: snowflake.Connection | null = null;
  private account: string;
  private username: string;
  private password: string;
  public database: string;
  private warehouse: string;
  private schema: string;
  private role: string;

  constructor() {
    // Initialize from environment variables
    this.account = process.env.SNOWFLAKE_ACCOUNT || '';
    this.username = process.env.SNOWFLAKE_USERNAME || '';
    this.password = process.env.SNOWFLAKE_PASSWORD || '';
    this.database = process.env.SNOWFLAKE_DATABASE || 'CFO_LINE';
    this.warehouse = process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH';
    this.schema = process.env.SNOWFLAKE_SCHEMA || 'PUBLIC';
    this.role = process.env.SNOWFLAKE_ROLE || 'ACCOUNTADMIN';
    
    // Log configuration (without sensitive data)
    console.log(`Snowflake configuration: account=${this.account}, database=${this.database}, warehouse=${this.warehouse}, schema=${this.schema}, role=${this.role}`);
  }

  /**
   * Create a connection to Snowflake
   */
  private async createConnection(): Promise<snowflake.Connection> {
    if (this.connection) {
      return this.connection;
    }

    // Validate configuration
    if (!this.account || !this.username || !this.password) {
      throw new ApiError(500, 'Snowflake configuration is incomplete. Please check your environment variables.');
    }

    return new Promise((resolve, reject) => {
      try {
        // Configure connection
        const connection = snowflake.createConnection({
          account: this.account,
          username: this.username,
          password: this.password,
          database: this.database,
          warehouse: this.warehouse,
          schema: this.schema,
          role: this.role
        });

        // Connect to Snowflake
        connection.connect((err, conn) => {
          if (err) {
            console.error('Error connecting to Snowflake:', err);
            reject(new ApiError(500, `Failed to connect to Snowflake: ${err.message}`));
            return;
          }
          
          console.log('Successfully connected to Snowflake');
          this.connection = conn;
          resolve(conn);
        });
      } catch (error) {
        console.error('Error creating Snowflake connection:', error);
        reject(new ApiError(500, `Failed to create Snowflake connection: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }

  /**
   * Initialize Snowflake for a new organization
   * 
   * @param organizationId The organization ID
   */
  async initializeForOrganization(organizationId: string): Promise<void> {
    try {
      const connection = await this.createConnection();
      
      // Create organization-specific schema
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      
      await this.executeStatement(`
        CREATE SCHEMA IF NOT EXISTS ${this.database}.${schemaName}
      `);
      
      // Create tables for each entity type
      await this.createTransactionsTable(organizationId);
      await this.createAccountsTable(organizationId);
      await this.createInvoicesTable(organizationId);
      await this.createContactsTable(organizationId);
      
      console.log(`Initialized Snowflake for organization ${organizationId}`);
    } catch (error) {
      console.error('Error initializing Snowflake:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to initialize Snowflake: ${errorMessage}`);
    }
  }

  /**
   * Create the transactions table for an organization
   * 
   * @param organizationId The organization ID
   */
  private async createTransactionsTable(organizationId: string): Promise<void> {
    const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
    const tableName = 'TRANSACTIONS';
    
    await this.executeStatement(`
      CREATE TABLE IF NOT EXISTS ${this.database}.${schemaName}.${tableName} (
        TRANSACTION_ID VARCHAR(255) NOT NULL,
        ORGANIZATION_ID VARCHAR(255) NOT NULL,
        DATE DATE NOT NULL,
        DESCRIPTION VARCHAR(1000),
        REFERENCE VARCHAR(255),
        STATUS VARCHAR(50),
        AMOUNT FLOAT,
        ACCOUNTS VARCHAR(1000),
        CREATED_AT TIMESTAMP_NTZ,
        YEAR NUMBER(4),
        MONTH NUMBER(2),
        DAY NUMBER(2),
        SOURCE VARCHAR(50) DEFAULT 'QUICKBOOKS',
        PRIMARY KEY (TRANSACTION_ID)
      )
    `);
  }

  /**
   * Create the accounts table for an organization
   * 
   * @param organizationId The organization ID
   */
  private async createAccountsTable(organizationId: string): Promise<void> {
    const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
    const tableName = 'ACCOUNTS';
    
    await this.executeStatement(`
      CREATE TABLE IF NOT EXISTS ${this.database}.${schemaName}.${tableName} (
        ACCOUNT_ID VARCHAR(255) NOT NULL,
        ORGANIZATION_ID VARCHAR(255) NOT NULL,
        NAME VARCHAR(255) NOT NULL,
        TYPE VARCHAR(50),
        SUBTYPE VARCHAR(50),
        BALANCE FLOAT,
        CURRENCY VARCHAR(10),
        IS_ACTIVE BOOLEAN,
        CREATED_AT TIMESTAMP_NTZ,
        SOURCE VARCHAR(50) DEFAULT 'QUICKBOOKS',
        PRIMARY KEY (ACCOUNT_ID)
      )
    `);
  }

  /**
   * Create the invoices table for an organization
   * 
   * @param organizationId The organization ID
   */
  private async createInvoicesTable(organizationId: string): Promise<void> {
    const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
    const tableName = 'INVOICES';
    
    await this.executeStatement(`
      CREATE TABLE IF NOT EXISTS ${this.database}.${schemaName}.${tableName} (
        INVOICE_ID VARCHAR(255) NOT NULL,
        ORGANIZATION_ID VARCHAR(255) NOT NULL,
        CUSTOMER_ID VARCHAR(255),
        CUSTOMER_NAME VARCHAR(255),
        DATE DATE,
        DUE_DATE DATE,
        TOTAL_AMOUNT FLOAT,
        BALANCE FLOAT,
        STATUS VARCHAR(50),
        CURRENCY VARCHAR(10),
        CREATED_AT TIMESTAMP_NTZ,
        YEAR NUMBER(4),
        MONTH NUMBER(2),
        DAY NUMBER(2),
        SOURCE VARCHAR(50) DEFAULT 'QUICKBOOKS',
        PRIMARY KEY (INVOICE_ID)
      )
    `);
  }

  /**
   * Create the contacts table for an organization
   * 
   * @param organizationId The organization ID
   */
  private async createContactsTable(organizationId: string): Promise<void> {
    const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
    const tableName = 'CONTACTS';
    
    await this.executeStatement(`
      CREATE TABLE IF NOT EXISTS ${this.database}.${schemaName}.${tableName} (
        CONTACT_ID VARCHAR(255) NOT NULL,
        ORGANIZATION_ID VARCHAR(255) NOT NULL,
        NAME VARCHAR(255) NOT NULL,
        TYPE VARCHAR(50),
        EMAIL VARCHAR(255),
        PHONE VARCHAR(50),
        ADDRESS VARCHAR(1000),
        IS_ACTIVE BOOLEAN,
        BALANCE FLOAT,
        CREATED_AT TIMESTAMP_NTZ,
        SOURCE VARCHAR(50) DEFAULT 'QUICKBOOKS',
        PRIMARY KEY (CONTACT_ID)
      )
    `);
  }

  /**
   * Execute a SQL statement on Snowflake
   * 
   * @param sql The SQL statement to execute
   * @returns The result of the statement
   */
  async executeStatement(sql: string): Promise<any> {
    const connection = await this.createConnection();
    
    return new Promise((resolve, reject) => {
      connection.execute({
        sqlText: sql,
        complete: (err, stmt, rows) => {
          if (err) {
            console.error('Error executing SQL:', err);
            reject(new ApiError(500, `Failed to execute SQL: ${err.message}`));
            return;
          }
          
          resolve(rows);
        }
      });
    });
  }

  /**
   * Export transactions to Snowflake
   * 
   * @param organizationId The organization ID
   * @returns Number of records exported
   */
  async exportTransactions(organizationId: string): Promise<number> {
    try {
      // Get all transactions for the organization
      const transactions = await prisma.transaction.findMany({
        where: { organizationId },
        include: {
          ledgerEntries: {
            include: {
              debitAccount: true,
              creditAccount: true
            }
          }
        }
      });

      if (transactions.length === 0) {
        return 0;
      }

      // Transform transactions for Snowflake
      const transformedTransactions = transactions.map(transaction => {
        // Calculate total amount of the transaction
        const totalAmount = transaction.ledgerEntries.reduce((sum, entry) => sum + entry.amount, 0);
        
        // Get accounts involved in the transaction
        const accounts = new Set<string>();
        transaction.ledgerEntries.forEach(entry => {
          if (entry.debitAccountId) accounts.add(entry.debitAccount!.name);
          if (entry.creditAccountId) accounts.add(entry.creditAccount!.name);
        });
        
        return {
          transaction_id: transaction.id,
          organization_id: transaction.organizationId,
          date: transaction.date.toISOString().split('T')[0],
          description: transaction.description,
          reference: transaction.reference,
          status: transaction.status,
          amount: totalAmount,
          accounts: Array.from(accounts).join(','),
          created_at: transaction.createdAt.toISOString(),
          year: transaction.date.getFullYear(),
          month: transaction.date.getMonth() + 1,
          day: transaction.date.getDate()
        };
      });

      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'TRANSACTIONS';
      
      // Clear existing data for this organization
      await this.executeStatement(`
        DELETE FROM ${this.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
      `);
      
      // Insert new data
      for (const transaction of transformedTransactions) {
        await this.executeStatement(`
          INSERT INTO ${this.database}.${schemaName}.${tableName} (
            TRANSACTION_ID, ORGANIZATION_ID, DATE, DESCRIPTION, REFERENCE,
            STATUS, AMOUNT, ACCOUNTS, CREATED_AT, YEAR, MONTH, DAY
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
            ${transaction.day}
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
   * Export accounts to Snowflake
   * 
   * @param organizationId The organization ID
   * @returns Number of records exported
   */
  async exportAccounts(organizationId: string): Promise<number> {
    try {
      // Get all accounts for the organization
      const accounts = await prisma.account.findMany({
        where: { organizationId },
        include: { organization: true }
      });

      if (accounts.length === 0) {
        return 0;
      }

      // Transform accounts for Snowflake
      const transformedAccounts = accounts.map(account => {
        return {
          account_id: account.id,
          organization_id: account.organizationId,
          name: account.name,
          type: account.type,
          subtype: account.subtype,
          balance: account.balance,
          currency: account.organization.defaultCurrency,
          is_active: account.isActive,
          created_at: account.createdAt.toISOString()
        };
      });

      // Insert data into Snowflake
      const schemaName = `ORG_${organizationId.replace(/-/g, '_')}`;
      const tableName = 'ACCOUNTS';
      
      // Clear existing data for this organization
      await this.executeStatement(`
        DELETE FROM ${this.database}.${schemaName}.${tableName}
        WHERE ORGANIZATION_ID = '${organizationId}'
      `);
      
      // Insert new data
      for (const account of transformedAccounts) {
        await this.executeStatement(`
          INSERT INTO ${this.database}.${schemaName}.${tableName} (
            ACCOUNT_ID, ORGANIZATION_ID, NAME, TYPE, SUBTYPE,
            BALANCE, CURRENCY, IS_ACTIVE, CREATED_AT
          ) VALUES (
            '${account.account_id}',
            '${account.organization_id}',
            '${account.name.replace(/'/g, "''")}',
            '${account.type}',
            '${account.subtype}',
            ${account.balance},
            '${account.currency}',
            ${account.is_active},
            '${account.created_at}'
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
      // Initialize Snowflake for the organization if needed
      await this.initializeForOrganization(organizationId);
      
      // Export each entity type
      const transactionCount = await this.exportTransactions(organizationId);
      const accountCount = await this.exportAccounts(organizationId);
      
      // TODO: Implement exportInvoices and exportContacts methods
      // For now, return 0 for these counts
      const invoiceCount = 0;
      const contactCount = 0;
      
      return {
        transactions: transactionCount,
        accounts: accountCount,
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
   * Close the Snowflake connection
   */
  async closeConnection(): Promise<void> {
    if (this.connection) {
      return new Promise((resolve, reject) => {
        this.connection!.destroy((err) => {
          if (err) {
            console.error('Error closing Snowflake connection:', err);
            reject(err);
            return;
          }
          
          this.connection = null;
          resolve();
        });
      });
    }
  }
}

// Export singleton instance
export const snowflakeService = new SnowflakeService(); 