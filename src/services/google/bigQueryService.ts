import { BigQuery } from '@google-cloud/bigquery';
import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';

/**
 * Service for interacting with Google BigQuery for data analytics
 */
export class BigQueryService {
  private bigquery: BigQuery;
  private projectId: string;
  private datasetId: string;

  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;
    this.datasetId = process.env.BIGQUERY_DATASET || 'finance_analytics';

    // Initialize BigQuery client
    this.bigquery = new BigQuery({
      projectId: this.projectId,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE
    });
  }

  /**
   * Initialize the BigQuery dataset and tables for a new organization
   * 
   * @param organizationId The organization ID
   */
  async initializeForOrganization(organizationId: string): Promise<void> {
    try {
      // Create dataset if it doesn't exist
      await this.createDatasetIfNotExists();
      
      // Create organization-specific tables
      await this.createTransactionsTable(organizationId);
      await this.createAccountsTable(organizationId);
      await this.createInvoicesTable(organizationId);
      await this.createContactsTable(organizationId);
    } catch (error) {
      console.error('Error initializing BigQuery:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to initialize BigQuery: ${errorMessage}`);
    }
  }

  /**
   * Export organization transaction data to BigQuery
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

      // Transform transactions for BigQuery
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
          date: transaction.date.toISOString(),
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

      // Insert data into BigQuery
      const tableName = `transactions_${organizationId.replace(/-/g, '_')}`;
      const dataset = this.bigquery.dataset(this.datasetId);
      const table = dataset.table(tableName);
      
      await table.insert(transformedTransactions);
      
      return transformedTransactions.length;
    } catch (error) {
      console.error('Error exporting transactions to BigQuery:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export transactions: ${errorMessage}`);
    }
  }

  /**
   * Export organization account data to BigQuery
   * 
   * @param organizationId The organization ID
   * @returns Number of records exported
   */
  async exportAccounts(organizationId: string): Promise<number> {
    try {
      // Get all accounts for the organization
      const accounts = await prisma.account.findMany({
        where: { organizationId }
      });

      if (accounts.length === 0) {
        return 0;
      }

      // Transform accounts for BigQuery
      const transformedAccounts = accounts.map(account => {
        return {
          account_id: account.id,
          organization_id: account.organizationId,
          name: account.name,
          code: account.code,
          type: account.type,
          subtype: account.subtype || '',
          description: account.description || '',
          is_active: account.isActive,
          balance: account.balance,
          created_at: account.createdAt.toISOString(),
          updated_at: account.updatedAt.toISOString()
        };
      });

      // Insert data into BigQuery
      const tableName = `accounts_${organizationId.replace(/-/g, '_')}`;
      const dataset = this.bigquery.dataset(this.datasetId);
      const table = dataset.table(tableName);
      
      await table.insert(transformedAccounts);
      
      return transformedAccounts.length;
    } catch (error) {
      console.error('Error exporting accounts to BigQuery:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to export accounts: ${errorMessage}`);
    }
  }

  /**
   * Run a cashflow analysis query in BigQuery
   * 
   * @param organizationId The organization ID
   * @param startDate Starting date for the analysis
   * @param endDate Ending date for the analysis
   * @returns Query results
   */
  async analyzeCashFlow(organizationId: string, startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const tableName = `transactions_${organizationId.replace(/-/g, '_')}`;
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const query = `
        SELECT
          EXTRACT(YEAR FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', date)) as year,
          EXTRACT(MONTH FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', date)) as month,
          SUM(amount) as net_cash_flow
        FROM
          \`${this.projectId}.${this.datasetId}.${tableName}\`
        WHERE
          organization_id = '${organizationId}'
          AND date BETWEEN '${startDateStr}' AND '${endDateStr}'
          AND accounts LIKE '%Cash%'
        GROUP BY
          year, month
        ORDER BY
          year, month
      `;
      
      const [rows] = await this.bigquery.query(query);
      return rows;
    } catch (error) {
      console.error('Error analyzing cash flow:', error);
      console.error('Error running cash flow analysis:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to analyze cash flow: ${errorMessage}`);
    }
  }

  /**
   * Run an expense trend analysis in BigQuery
   * 
   * @param organizationId The organization ID
   * @param months Number of months to analyze
   * @returns Query results
   */
  async analyzeExpenseTrends(organizationId: string, months: number = 6): Promise<any[]> {
    try {
      const tableName = `transactions_${organizationId.replace(/-/g, '_')}`;
      
      const query = `
        WITH expense_accounts AS (
          SELECT account_id, name
          FROM \`${this.projectId}.${this.datasetId}.accounts_${organizationId.replace(/-/g, '_')}\`
          WHERE type = 'EXPENSE'
        ),
        
        monthly_expenses AS (
          SELECT
            EXTRACT(YEAR FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', date)) as year,
            EXTRACT(MONTH FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', date)) as month,
            accounts,
            SUM(amount) as total_amount
          FROM
            \`${this.projectId}.${this.datasetId}.${tableName}\`
          WHERE
            organization_id = '${organizationId}'
            AND date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
          GROUP BY
            year, month, accounts
        )
        
        SELECT
          year,
          month,
          accounts as expense_category,
          total_amount
        FROM
          monthly_expenses
        ORDER BY
          year, month, total_amount DESC
      `;
      
      const [rows] = await this.bigquery.query(query);
      return rows;
    } catch (error) {
      console.error('Error analyzing expense trends:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to analyze expense trends: ${errorMessage}`);
    }
  }

  /**
   * Get business profitability over time
   * 
   * @param organizationId The organization ID
   * @param months Number of months to analyze
   * @returns Query results
   */
  async getMonthlyProfitability(organizationId: string, months: number = 12): Promise<any[]> {
    try {
      const tableName = `transactions_${organizationId.replace(/-/g, '_')}`;
      const accountsTable = `accounts_${organizationId.replace(/-/g, '_')}`;
      
      const query = `
        WITH revenue_transactions AS (
          SELECT
            EXTRACT(YEAR FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', t.date)) as year,
            EXTRACT(MONTH FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', t.date)) as month,
            SUM(t.amount) as revenue
          FROM
            \`${this.projectId}.${this.datasetId}.${tableName}\` t
          JOIN
            \`${this.projectId}.${this.datasetId}.${accountsTable}\` a
          ON
            STRPOS(t.accounts, a.name) > 0
          WHERE
            t.organization_id = '${organizationId}'
            AND a.type = 'REVENUE'
            AND t.date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
          GROUP BY
            year, month
        ),
        
        expense_transactions AS (
          SELECT
            EXTRACT(YEAR FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', t.date)) as year,
            EXTRACT(MONTH FROM PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%S%Ez', t.date)) as month,
            SUM(t.amount) as expenses
          FROM
            \`${this.projectId}.${this.datasetId}.${tableName}\` t
          JOIN
            \`${this.projectId}.${this.datasetId}.${accountsTable}\` a
          ON
            STRPOS(t.accounts, a.name) > 0
          WHERE
            t.organization_id = '${organizationId}'
            AND a.type = 'EXPENSE'
            AND t.date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${months} MONTH)
          GROUP BY
            year, month
        )
        
        SELECT
          r.year,
          r.month,
          r.revenue,
          e.expenses,
          (r.revenue - e.expenses) as profit,
          CASE 
            WHEN r.revenue > 0 THEN (r.revenue - e.expenses) / r.revenue 
            ELSE 0 
          END as profit_margin
        FROM
          revenue_transactions r
        LEFT JOIN
          expense_transactions e
        ON
          r.year = e.year AND r.month = e.month
        ORDER BY
          r.year, r.month
      `;
      
      const [rows] = await this.bigquery.query(query);
      return rows;
    } catch (error) {
      console.error('Error getting profitability data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to get profitability: ${errorMessage}`);
    }
  }

  // Private helper methods

  /**
   * Create the dataset if it doesn't exist
   */
  private async createDatasetIfNotExists(): Promise<void> {
    try {
      const [datasets] = await this.bigquery.getDatasets();
      const datasetExists = datasets.some(dataset => dataset.id === this.datasetId);
      
      if (!datasetExists) {
        await this.bigquery.createDataset(this.datasetId, {
          location: process.env.GOOGLE_CLOUD_REGION || 'US'
        });
        console.log(`Dataset ${this.datasetId} created.`);
      }
    } catch (error) {
      console.error('Error creating dataset:', error);
      throw error;
    }
  }

  /**
   * Create the transactions table for an organization
   */
  private async createTransactionsTable(organizationId: string): Promise<void> {
    const schema = [
      { name: 'transaction_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'organization_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'date', type: 'STRING', mode: 'REQUIRED' },
      { name: 'description', type: 'STRING', mode: 'NULLABLE' },
      { name: 'reference', type: 'STRING', mode: 'NULLABLE' },
      { name: 'status', type: 'STRING', mode: 'REQUIRED' },
      { name: 'amount', type: 'FLOAT', mode: 'REQUIRED' },
      { name: 'accounts', type: 'STRING', mode: 'NULLABLE' },
      { name: 'created_at', type: 'STRING', mode: 'REQUIRED' },
      { name: 'year', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'month', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'day', type: 'INTEGER', mode: 'REQUIRED' }
    ];
    
    const tableName = `transactions_${organizationId.replace(/-/g, '_')}`;
    const dataset = this.bigquery.dataset(this.datasetId);
    
    try {
      // Check if table exists
      const [tableExists] = await dataset.table(tableName).exists();
      
      if (!tableExists) {
        // Create the table
        await dataset.createTable(tableName, {
          schema: schema,
          timePartitioning: {
            type: 'MONTH',
            field: 'date'
          }
        });
        console.log(`Table ${tableName} created.`);
      }
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Create the accounts table for an organization
   */
  private async createAccountsTable(organizationId: string): Promise<void> {
    const schema = [
      { name: 'account_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'organization_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'REQUIRED' },
      { name: 'code', type: 'STRING', mode: 'REQUIRED' },
      { name: 'type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'subtype', type: 'STRING', mode: 'NULLABLE' },
      { name: 'description', type: 'STRING', mode: 'NULLABLE' },
      { name: 'is_active', type: 'BOOLEAN', mode: 'REQUIRED' },
      { name: 'balance', type: 'FLOAT', mode: 'REQUIRED' },
      { name: 'created_at', type: 'STRING', mode: 'REQUIRED' },
      { name: 'updated_at', type: 'STRING', mode: 'REQUIRED' }
    ];
    
    const tableName = `accounts_${organizationId.replace(/-/g, '_')}`;
    const dataset = this.bigquery.dataset(this.datasetId);
    
    try {
      // Check if table exists
      const [tableExists] = await dataset.table(tableName).exists();
      
      if (!tableExists) {
        // Create the table
        await dataset.createTable(tableName, { schema });
        console.log(`Table ${tableName} created.`);
      }
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Create the invoices table for an organization
   */
  private async createInvoicesTable(organizationId: string): Promise<void> {
    const schema = [
      { name: 'invoice_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'organization_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'number', type: 'STRING', mode: 'REQUIRED' },
      { name: 'date', type: 'STRING', mode: 'REQUIRED' },
      { name: 'due_date', type: 'STRING', mode: 'REQUIRED' },
      { name: 'status', type: 'STRING', mode: 'REQUIRED' },
      { name: 'contact_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'contact_name', type: 'STRING', mode: 'REQUIRED' },
      { name: 'subtotal', type: 'FLOAT', mode: 'REQUIRED' },
      { name: 'tax_amount', type: 'FLOAT', mode: 'REQUIRED' },
      { name: 'total', type: 'FLOAT', mode: 'REQUIRED' },
      { name: 'year', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'month', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'created_at', type: 'STRING', mode: 'REQUIRED' }
    ];
    
    const tableName = `invoices_${organizationId.replace(/-/g, '_')}`;
    const dataset = this.bigquery.dataset(this.datasetId);
    
    try {
      // Check if table exists
      const [tableExists] = await dataset.table(tableName).exists();
      
      if (!tableExists) {
        // Create the table
        await dataset.createTable(tableName, { 
          schema,
          timePartitioning: {
            type: 'MONTH',
            field: 'date'
          }
        });
        console.log(`Table ${tableName} created.`);
      }
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Create the contacts table for an organization
   */
  private async createContactsTable(organizationId: string): Promise<void> {
    const schema = [
      { name: 'contact_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'organization_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'REQUIRED' },
      { name: 'type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'email', type: 'STRING', mode: 'NULLABLE' },
      { name: 'phone', type: 'STRING', mode: 'NULLABLE' },
      { name: 'address', type: 'STRING', mode: 'NULLABLE' },
      { name: 'city', type: 'STRING', mode: 'NULLABLE' },
      { name: 'state', type: 'STRING', mode: 'NULLABLE' },
      { name: 'zip', type: 'STRING', mode: 'NULLABLE' },
      { name: 'country', type: 'STRING', mode: 'NULLABLE' },
      { name: 'is_active', type: 'BOOLEAN', mode: 'REQUIRED' },
      { name: 'created_at', type: 'STRING', mode: 'REQUIRED' }
    ];
    
    const tableName = `contacts_${organizationId.replace(/-/g, '_')}`;
    const dataset = this.bigquery.dataset(this.datasetId);
    
    try {
      // Check if table exists
      const [tableExists] = await dataset.table(tableName).exists();
      
      if (!tableExists) {
        // Create the table
        await dataset.createTable(tableName, { schema });
        console.log(`Table ${tableName} created.`);
      }
    } catch (error) {
      console.error(`Error creating table ${tableName}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const bigQueryService = new BigQueryService(); 