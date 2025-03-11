import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';
import { BigQuery } from '@google-cloud/bigquery';

/**
 * Service for generating financial insights from accounting data
 */
export class FinancialInsightService {
  private bigquery: BigQuery;
  private datasetId: string;

  constructor() {
    // Initialize BigQuery client
    this.bigquery = new BigQuery({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE
    });
    
    this.datasetId = process.env.BIGQUERY_DATASET || 'finance_analytics';
  }

  /**
   * Generate all insights for an organization
   * 
   * @param organizationId The organization ID
   * @returns Number of insights generated
   */
  async generateAllInsights(organizationId: string): Promise<number> {
    try {
      // Check if organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId }
      });

      if (!organization) {
        throw new ApiError(404, 'Organization not found');
      }

      // Generate each type of insight
      await this.generateCashFlowInsights(organizationId);
      await this.generateProfitabilityInsights(organizationId);
      await this.generateReceivablesInsights(organizationId);
      await this.generateExpenseInsights(organizationId);

      // Count total insights generated
      const count = await prisma.financialInsight.count({
        where: { organizationId }
      });

      return count;
    } catch (error: any) {
      console.error('Error generating insights:', error);
      throw new ApiError(500, `Failed to generate insights: ${error.message}`);
    }
  }

  /**
   * Generate cash flow insights
   * 
   * @param organizationId The organization ID
   */
  async generateCashFlowInsights(organizationId: string): Promise<void> {
    try {
      // Query cash accounts from the database
      const cashAccounts = await prisma.account.findMany({
        where: {
          organizationId,
          type: 'ASSET',
          subtype: { in: ['Cash', 'Bank'] }
        }
      });

      if (cashAccounts.length === 0) {
        console.log('No cash accounts found, skipping cash flow insights');
        return;
      }

      // Get cash account IDs
      const cashAccountIds = cashAccounts.map(account => account.id);

      // Get transactions for the past 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const transactions = await prisma.transaction.findMany({
        where: {
          organizationId,
          date: { gte: ninetyDaysAgo }
        },
        include: {
          ledgerEntries: {
            include: {
              debitAccount: true,
              creditAccount: true
            }
          }
        },
        orderBy: { date: 'asc' }
      });

      // Calculate cash flow trend
      const cashFlowByWeek = this.calculateCashFlowByWeek(transactions, cashAccountIds);

      // Generate cash flow forecast
      const cashFlowForecast = this.predictCashFlowNextFourWeeks(cashFlowByWeek);

      // Create insight if significant trend is found
      if (this.isCashFlowTrendSignificant(cashFlowByWeek)) {
        // Determine if trend is positive or negative
        const trend = this.determineCashFlowTrend(cashFlowByWeek);
        
        await prisma.financialInsight.create({
          data: {
            organizationId,
            type: 'CASH_FLOW',
            title: trend === 'positive' 
              ? 'Positive Cash Flow Trend' 
              : 'Negative Cash Flow Trend',
            description: trend === 'positive'
              ? 'Your cash flow is showing a positive trend over the past months.'
              : 'Your cash flow is showing a negative trend that requires attention.',
            priority: trend === 'positive' ? 3 : 5,
            data: {
              trend,
              historic: cashFlowByWeek,
              forecast: cashFlowForecast
            }
          }
        });
      }

      // Create forecast insight
      await prisma.financialInsight.create({
        data: {
          organizationId,
          type: 'CASH_FLOW',
          title: 'Cash Flow Forecast',
          description: 'Projected cash flow for the next 4 weeks based on historical data.',
          priority: 3,
          data: {
            historic: cashFlowByWeek,
            forecast: cashFlowForecast
          }
        }
      });
    } catch (error) {
      console.error('Error generating cash flow insights:', error);
      throw error;
    }
  }

  /**
   * Generate profitability insights
   * 
   * @param organizationId The organization ID
   */
  async generateProfitabilityInsights(organizationId: string): Promise<void> {
    try {
      // Query revenue and expense accounts
      const revenueAccounts = await prisma.account.findMany({
        where: {
          organizationId,
          type: 'REVENUE'
        }
      });
      
      const expenseAccounts = await prisma.account.findMany({
        where: {
          organizationId,
          type: 'EXPENSE'
        }
      });

      if (revenueAccounts.length === 0 || expenseAccounts.length === 0) {
        console.log('No revenue or expense accounts found, skipping profitability insights');
        return;
      }

      // Get transactions for the past 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Calculate monthly revenue, expenses, and profit
      const monthlyProfitability = await this.calculateMonthlyProfitability(organizationId, ninetyDaysAgo);

      // Generate insights based on profitability data
      if (monthlyProfitability.length >= 3) {
        const trend = this.determineProfitabilityTrend(monthlyProfitability);
        
        // Create insight
        await prisma.financialInsight.create({
          data: {
            organizationId,
            type: 'PROFITABILITY',
            title: `${trend === 'positive' ? 'Improving' : 'Declining'} Profitability`,
            description: trend === 'positive'
              ? 'Your profitability has been improving over the past months.'
              : 'Your profitability has been declining over the past months.',
            priority: trend === 'positive' ? 2 : 4,
            data: {
              trend,
              monthly: monthlyProfitability
            }
          }
        });
      }
    } catch (error) {
      console.error('Error generating profitability insights:', error);
      throw error;
    }
  }

  /**
   * Generate accounts receivable insights
   * 
   * @param organizationId The organization ID
   */
  async generateReceivablesInsights(organizationId: string): Promise<void> {
    try {
      // Query open invoices
      const openInvoices = await prisma.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] as any[] }
        },
        include: {
          contact: true
        },
        orderBy: { dueDate: 'asc' }
      });

      if (openInvoices.length === 0) {
        console.log('No open invoices found, skipping receivables insights');
        return;
      }

      // Find overdue invoices
      const overdueInvoices = openInvoices.filter(invoice => {
        return invoice.dueDate < new Date();
      });

      // Calculate aging buckets (1-30 days, 31-60 days, 61-90 days, 90+ days)
      const agingBuckets = this.calculateAgingBuckets(overdueInvoices);

      // Generate insights for significant overdue amounts
      if (overdueInvoices.length > 0) {
        const totalOverdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
        
        await prisma.financialInsight.create({
          data: {
            organizationId,
            type: 'RECEIVABLES',
            title: 'Overdue Receivables',
            description: `You have ${overdueInvoices.length} overdue invoices totaling ${totalOverdueAmount.toFixed(2)} ${openInvoices[0]?.organization?.defaultCurrency || 'USD'}.`,
            priority: totalOverdueAmount > 10000 ? 5 : (totalOverdueAmount > 5000 ? 4 : 3),
            data: {
              overdueCount: overdueInvoices.length,
              totalOverdueAmount,
              agingBuckets
            }
          }
        });
      }

      // Identify customers with repeated late payments
      const customersWithLatePayments = this.identifyLatePayingCustomers(overdueInvoices);
      
      // Generate insight for each problematic customer
      for (const customer of customersWithLatePayments) {
        if (customer.overdueInvoices.length >= 3) {
          await prisma.financialInsight.create({
            data: {
              organizationId,
              type: 'RECEIVABLES',
              title: 'Customer with Repeated Late Payments',
              description: `${customer.name} has ${customer.overdueInvoices.length} overdue invoices totaling ${customer.totalAmount.toFixed(2)}.`,
              priority: 4,
              data: {
                customerId: customer.id,
                customerName: customer.name,
                invoiceCount: customer.overdueInvoices.length,
                totalAmount: customer.totalAmount
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('Error generating receivables insights:', error);
      throw error;
    }
  }

  /**
   * Generate expense insights
   * 
   * @param organizationId The organization ID
   */
  async generateExpenseInsights(organizationId: string): Promise<void> {
    try {
      // Query expense accounts
      const expenseAccounts = await prisma.account.findMany({
        where: {
          organizationId,
          type: 'EXPENSE'
        }
      });

      if (expenseAccounts.length === 0) {
        console.log('No expense accounts found, skipping expense insights');
        return;
      }

      // Get expense transactions for the past 180 days
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);

      // Calculate monthly expenses by category
      const monthlyExpensesByCategory = await this.calculateMonthlyExpensesByCategory(organizationId, sixMonthsAgo);

      // Find expense categories with significant increases
      const increasedCategories = this.findExpenseCategoriesWithSignificantChanges(monthlyExpensesByCategory, 0.2);

      // Generate insights for expense categories with significant increases
      for (const category of increasedCategories) {
        await prisma.financialInsight.create({
          data: {
            organizationId,
            type: 'EXPENSE',
            title: `${category.name} Expenses Increasing`,
            description: `Your ${category.name} expenses have increased by ${(category.increasePercentage * 100).toFixed(0)}% compared to previous months.`,
            priority: category.increasePercentage > 0.5 ? 4 : 3,
            data: {
              category: category.name,
              increasePercentage: category.increasePercentage,
              monthlyData: category.monthlyData
            }
          }
        });
      }
    } catch (error) {
      console.error('Error generating expense insights:', error);
      throw error;
    }
  }

  /**
   * Get all insights for an organization
   * 
   * @param organizationId The organization ID
   * @param limit Maximum number of insights to return
   * @param includeRead Whether to include read insights
   * @returns Array of insights
   */
  async getInsights(organizationId: string, limit: number = 10, includeRead: boolean = false): Promise<any[]> {
    const where: any = { organizationId };
    
    if (!includeRead) {
      where.isRead = false;
    }

    const insights = await prisma.financialInsight.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ],
      take: limit
    });

    return insights;
  }

  /**
   * Mark an insight as read
   * 
   * @param insightId The insight ID
   */
  async markInsightAsRead(insightId: string): Promise<void> {
    await prisma.financialInsight.update({
      where: { id: insightId },
      data: { isRead: true }
    });
  }

  /**
   * Mark all insights for an organization as read
   * 
   * @param organizationId The organization ID
   */
  async markAllInsightsAsRead(organizationId: string): Promise<void> {
    await prisma.financialInsight.updateMany({
      where: { 
        organizationId,
        isRead: false
      },
      data: { isRead: true }
    });
  }

  /**
   * Delete old insights
   * 
   * @param organizationId The organization ID
   * @param olderThanDays Delete insights older than this many days
   * @returns Number of insights deleted
   */
  async deleteOldInsights(organizationId: string, olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await prisma.financialInsight.deleteMany({
      where: {
        organizationId,
        createdAt: { lt: cutoffDate }
      }
    });

    return result.count;
  }

  // Helper methods for insight generation

  /**
   * Calculate cash flow by week from transactions
   */
  private calculateCashFlowByWeek(transactions: any[], cashAccountIds: string[]): any[] {
    // Implementation would calculate weekly cash flow from transactions
    // This is a simplified example
    const weeklyData: any[] = [];
    
    // Group transactions by week and calculate net cash flow
    // ... calculation logic here ...
    
    return weeklyData;
  }

  /**
   * Predict cash flow for the next four weeks
   */
  private predictCashFlowNextFourWeeks(historicCashFlow: any[]): any[] {
    // Implementation would use historical data to predict future cash flow
    // This is a simplified example
    const forecast: any[] = [];
    
    // Use simple moving average or more complex algorithm
    // ... forecasting logic here ...
    
    return forecast;
  }

  /**
   * Determine if cash flow trend is significant
   */
  private isCashFlowTrendSignificant(cashFlowByWeek: any[]): boolean {
    // Implementation would determine if the trend is statistically significant
    // This is a simplified example
    return true;
  }

  /**
   * Determine cash flow trend direction
   */
  private determineCashFlowTrend(cashFlowByWeek: any[]): 'positive' | 'negative' {
    // Implementation would analyze the trend direction
    // This is a simplified example
    return 'positive';
  }

  /**
   * Calculate monthly profitability
   */
  private async calculateMonthlyProfitability(organizationId: string, startDate: Date): Promise<any[]> {
    // Implementation would calculate monthly revenue, expenses, and profit
    // This is a simplified example
    return [];
  }

  /**
   * Determine profitability trend
   */
  private determineProfitabilityTrend(monthlyProfitability: any[]): 'positive' | 'negative' {
    // Implementation would analyze the trend direction
    // This is a simplified example
    return 'positive';
  }

  /**
   * Calculate aging buckets for receivables
   */
  private calculateAgingBuckets(overdueInvoices: any[]): any {
    // Implementation would categorize invoices into aging buckets
    // This is a simplified example
    return {
      '1-30days': 0,
      '31-60days': 0,
      '61-90days': 0,
      '90plus': 0
    };
  }

  /**
   * Identify customers with repeated late payments
   */
  private identifyLatePayingCustomers(overdueInvoices: any[]): any[] {
    // Implementation would group overdue invoices by customer
    // This is a simplified example
    return [];
  }

  /**
   * Calculate monthly expenses by category
   */
  private async calculateMonthlyExpensesByCategory(organizationId: string, startDate: Date): Promise<any[]> {
    // Implementation would group expenses by category and month
    // This is a simplified example
    return [];
  }

  /**
   * Find expense categories with significant changes
   */
  private findExpenseCategoriesWithSignificantChanges(monthlyExpensesByCategory: any[], threshold: number): any[] {
    // Implementation would identify categories with increases above threshold
    // This is a simplified example
    return [];
  }
}

// Export singleton instance
export const financialInsightService = new FinancialInsightService(); 