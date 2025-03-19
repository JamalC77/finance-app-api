import { prisma } from '../../utils/prisma';
import { ApiError } from '../../utils/errors';
import { quickbooksApiClient } from '../../services/quickbooks/quickbooksApiClient';
import { quickbooksAuthService } from '../../services/quickbooks/quickbooksAuthService';

/**
 * Controller for fetching dashboard data directly from QuickBooks
 */
class QuickbooksDashboardController {
  /**
   * Get dashboard data from QuickBooks
   * 
   * @param organizationId The organization ID
   * @returns Dashboard data from QuickBooks
   */
  async getDashboardData(organizationId: string) {
    try {
      // Verify connection exists and is active
      console.log(`🔍 [QB CONTROLLER] Checking QuickBooks connection for organization: ${organizationId}`);
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId }
      });

      if (!connection || !connection.isActive) {
        console.log(`❌ [QB CONTROLLER] No active connection found for organization: ${organizationId}`);
        throw new ApiError(400, 'No active QuickBooks connection');
      }

      console.log(`✅ [QB CONTROLLER] Found active connection, realmId: ${connection.realmId}`);
      const realmId = connection.realmId;

      // Set up date ranges for queries
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      // Start date is first day of current month
      const startDate = new Date(currentYear, currentMonth, 1);
      
      // End date is last day of current month
      const endDate = new Date(currentYear, currentMonth + 1, 0);
      
      // Get previous month date range for comparison
      const prevMonthStart = new Date(currentYear, currentMonth - 1, 1);
      const prevMonthEnd = new Date(currentYear, currentMonth, 0);

      // Six months ago for cash flow
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      
      // Format dates for QB queries
      const formatQBDate = (date: Date) => {
        return date.toISOString().split('T')[0];
      };
      
      console.log(`📅 [QB CONTROLLER] Query date ranges prepared: 
        Current: ${formatQBDate(startDate)} to ${formatQBDate(endDate)}
        Previous: ${formatQBDate(prevMonthStart)} to ${formatQBDate(prevMonthEnd)}
        Six months ago: ${formatQBDate(sixMonthsAgo)}`);

      // Fetch relevant data from QuickBooks
      // 1. Cash Balance (from accounts)
      try {
        console.log(`💼 [QB CONTROLLER] Querying cash accounts...`);
        // According to QuickBooks API docs, use single quotes for string literals
        const cashAccountsQuery = "SELECT * FROM Account WHERE AccountType = 'Bank'";
        const cashAccountsResponse = await quickbooksApiClient.query(organizationId, realmId, cashAccountsQuery);
        const cashAccounts = cashAccountsResponse.QueryResponse.Account || [];
        console.log(`💰 [QB CONTROLLER] Found ${cashAccounts.length} cash accounts`);
        
        // If successful, try to get other assets in a separate query
        if (cashAccounts.length >= 0) {
          console.log(`💼 [QB CONTROLLER] Querying other current assets...`);
          const otherAssetsQuery = "SELECT * FROM Account WHERE AccountType = 'Other Current Asset'";
          const otherAssetsResponse = await quickbooksApiClient.query(organizationId, realmId, otherAssetsQuery);
          const otherAssets = otherAssetsResponse.QueryResponse.Account || [];
          console.log(`💰 [QB CONTROLLER] Found ${otherAssets.length} other current assets`);
          
          // Combine the results
          cashAccounts.push(...otherAssets);
        }
        
        // 2. Current month invoices
        console.log(`📄 [QB CONTROLLER] Querying current month invoices...`);
        const currentInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(startDate)}' AND TxnDate <= '${formatQBDate(endDate)}'`;
        const currentInvoicesResponse = await quickbooksApiClient.query(organizationId, realmId, currentInvoicesQuery);
        const currentInvoices = currentInvoicesResponse.QueryResponse.Invoice || [];
        console.log(`📊 [QB CONTROLLER] Found ${currentInvoices.length} current month invoices`);
        
        // 3. Previous month invoices
        console.log(`📄 [QB CONTROLLER] Querying previous month invoices...`);
        const prevInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(prevMonthStart)}' AND TxnDate <= '${formatQBDate(prevMonthEnd)}'`;
        const prevInvoicesResponse = await quickbooksApiClient.query(organizationId, realmId, prevInvoicesQuery);
        const prevInvoices = prevInvoicesResponse.QueryResponse.Invoice || [];
        console.log(`📊 [QB CONTROLLER] Found ${prevInvoices.length} previous month invoices`);
        
        // 4. Current month expenses (purchases)
        console.log(`💸 [QB CONTROLLER] Querying current month expenses...`);
        const currentExpensesQuery = `SELECT * FROM Purchase WHERE TxnDate >= '${formatQBDate(startDate)}' AND TxnDate <= '${formatQBDate(endDate)}'`;
        const currentExpensesResponse = await quickbooksApiClient.query(organizationId, realmId, currentExpensesQuery);
        const currentExpenses = currentExpensesResponse.QueryResponse.Purchase || [];
        console.log(`📊 [QB CONTROLLER] Found ${currentExpenses.length} current month expenses`);
        
        // 5. Previous month expenses
        console.log(`💸 [QB CONTROLLER] Querying previous month expenses...`);
        const prevExpensesQuery = `SELECT * FROM Purchase WHERE TxnDate >= '${formatQBDate(prevMonthStart)}' AND TxnDate <= '${formatQBDate(prevMonthEnd)}'`;
        const prevExpensesResponse = await quickbooksApiClient.query(organizationId, realmId, prevExpensesQuery);
        const prevExpenses = prevExpensesResponse.QueryResponse.Purchase || [];
        console.log(`📊 [QB CONTROLLER] Found ${prevExpenses.length} previous month expenses`);
        
        // 6. Cash flow data (last 6 months)
        console.log(`📈 [QB CONTROLLER] Querying six month invoices...`);
        const sixMonthInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(sixMonthsAgo)}' AND TxnDate <= '${formatQBDate(endDate)}'`;
        const sixMonthInvoicesResponse = await quickbooksApiClient.query(organizationId, realmId, sixMonthInvoicesQuery);
        const sixMonthInvoices = sixMonthInvoicesResponse.QueryResponse.Invoice || [];
        console.log(`📊 [QB CONTROLLER] Found ${sixMonthInvoices.length} six month invoices`);
        
        console.log(`📉 [QB CONTROLLER] Querying six month expenses...`);
        const sixMonthExpensesQuery = `SELECT * FROM Purchase WHERE TxnDate >= '${formatQBDate(sixMonthsAgo)}' AND TxnDate <= '${formatQBDate(endDate)}'`;
        const sixMonthExpensesResponse = await quickbooksApiClient.query(organizationId, realmId, sixMonthExpensesQuery);
        const sixMonthExpenses = sixMonthExpensesResponse.QueryResponse.Purchase || [];
        console.log(`📊 [QB CONTROLLER] Found ${sixMonthExpenses.length} six month expenses`);
        
        // 7. Customers for top customers
        console.log(`👥 [QB CONTROLLER] Querying customers...`);
        const customersQuery = `SELECT * FROM Customer`;
        const customersResponse = await quickbooksApiClient.query(organizationId, realmId, customersQuery);
        const customers = customersResponse.QueryResponse.Customer || [];
        console.log(`📊 [QB CONTROLLER] Found ${customers.length} customers`);
        
        // Calculate dashboard metrics
        console.log(`🧮 [QB CONTROLLER] Calculating dashboard metrics...`);
        
        // Total cash balance from bank accounts
        const cashBalance = cashAccounts.reduce((sum, account) => sum + parseFloat(account.CurrentBalance || '0'), 0);
        
        // Current month income (total of received money)
        const currentIncome = currentInvoices.reduce((sum, invoice) => {
          // Calculate what's actually been received (TotalAmt - Balance)
          const receivedAmount = parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0');
          return sum + receivedAmount;
        }, 0);
        
        console.log(`💰 [QB CONTROLLER] Calculated current income: ${currentIncome}`);
        
        // Previous month income
        const prevIncome = prevInvoices.reduce((sum, invoice) => {
          // Calculate what's actually been received (TotalAmt - Balance)
          const receivedAmount = parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0');
          return sum + receivedAmount;
        }, 0);
        
        console.log(`💰 [QB CONTROLLER] Calculated previous income: ${prevIncome}`);
        
        // Calculate income change percentage
        const incomeChangePercentage = prevIncome === 0 
          ? 100 
          : Math.round((currentIncome - prevIncome) / prevIncome * 100);
        
        // Current month expenses
        const currentExpensesTotal = currentExpenses
          .reduce((sum, expense) => sum + parseFloat(expense.TotalAmt || '0'), 0);
        
        // Previous month expenses
        const prevExpensesTotal = prevExpenses
          .reduce((sum, expense) => sum + parseFloat(expense.TotalAmt || '0'), 0);
        
        // Calculate expenses change percentage
        const expensesChangePercentage = prevExpensesTotal === 0 
          ? 100 
          : Math.round((currentExpensesTotal - prevExpensesTotal) / prevExpensesTotal * 100);
        
        // Calculate profit/loss
        const currentProfitLoss = currentIncome - currentExpensesTotal;
        const prevProfitLoss = prevIncome - prevExpensesTotal;
        
        // Calculate profit/loss change percentage
        const profitLossChangePercentage = prevProfitLoss === 0 
          ? 100 
          : Math.round((currentProfitLoss - prevProfitLoss) / Math.abs(prevProfitLoss) * 100);
        
        // Calculate cash flow for each month in the last 6 months
        console.log(`📅 [QB CONTROLLER] Building cash flow data...`);
        const cashFlowData = [];
        
        for (let i = 0; i < 6; i++) {
          const monthDate = new Date();
          monthDate.setMonth(monthDate.getMonth() - i);
          monthDate.setDate(1);
          
          const monthStart = new Date(monthDate);
          const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
          
          // Format month name
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const formattedMonth = monthNames[monthDate.getMonth()];
          
          // Filter invoices for this month - removed "Balance === 0" filter to count all income
          const monthInvoices = sixMonthInvoices.filter(invoice => {
            const txnDate = new Date(invoice.TxnDate);
            return txnDate >= monthStart && txnDate <= monthEnd;
          });
          
          // Filter expenses for this month
          const monthExpenses = sixMonthExpenses.filter(expense => {
            const txnDate = new Date(expense.TxnDate);
            return txnDate >= monthStart && txnDate <= monthEnd;
          });
          
          // Calculate month totals - properly calculate received amounts
          const monthIncome = monthInvoices.reduce((sum, invoice) => {
            const receivedAmount = parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0');
            return sum + receivedAmount;
          }, 0);
          
          const monthExpensesTotal = monthExpenses.reduce((sum, expense) => 
            sum + parseFloat(expense.TotalAmt || '0'), 0);
          
          cashFlowData.push({
            month: formattedMonth,
            income: monthIncome,
            expenses: monthExpensesTotal,
            profit: monthIncome - monthExpensesTotal
          });
        }
        
        // Calculate top customers based on received money
        console.log(`👤 [QB CONTROLLER] Building top customer data...`);
        const customerRevenue = new Map();
        
        // Removed filter for Balance === 0 to include all customers with paid or partially paid invoices
        currentInvoices.forEach(invoice => {
          if (invoice.CustomerRef) {
            const customerId = invoice.CustomerRef.value;
            
            if (!customerRevenue.has(customerId)) {
              const customer = customers.find(c => c.Id === customerId);
              customerRevenue.set(customerId, {
                id: customerId,
                name: customer ? (customer.DisplayName || 'Customer') : 'Customer',
                revenue: 0
              });
            }
            
            const customerData = customerRevenue.get(customerId);
            // Only count the received amount (not the total invoice amount)
            const receivedAmount = parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0');
            customerData.revenue += receivedAmount;
          }
        });
        
        const topCustomers = Array.from(customerRevenue.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);
        
        // Calculate top expense categories
        console.log(`📋 [QB CONTROLLER] Building expense categories data...`);
        const expenseCategories = new Map();
        
        currentExpenses.forEach(expense => {
          if (expense.AccountRef) {
            const categoryId = expense.AccountRef.value;
            const categoryName = expense.AccountRef.name || 'Uncategorized';
            
            if (!expenseCategories.has(categoryId)) {
              expenseCategories.set(categoryId, {
                category: categoryName,
                amount: 0
              });
            }
            
            const categoryData = expenseCategories.get(categoryId);
            categoryData.amount += parseFloat(expense.TotalAmt || '0');
          }
        });
        
        const topExpenseCategories = Array.from(expenseCategories.values())
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);
        
        // Generate recent activity based on invoices and expenses
        console.log(`🔄 [QB CONTROLLER] Building recent activity data...`);
        const recentActivity = [
          // Include partially paid invoices too, not just fully paid ones
          ...currentInvoices
            .filter(invoice => parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0') > 0)
            .map(invoice => {
              const customerName = invoice.CustomerRef 
                ? (customers.find(c => c.Id === invoice.CustomerRef.value)?.DisplayName || 'Customer') 
                : 'Customer';
              
              // Use the received amount not the total
              const receivedAmount = parseFloat(invoice.TotalAmt || '0') - parseFloat(invoice.Balance || '0');
              const status = invoice.Balance === 0 ? 'fully' : 'partially';
              
              return {
                id: invoice.Id,
                type: 'INVOICE_PAID',
                description: `Invoice #${invoice.DocNumber || ''} ${status} paid by ${customerName}`,
                date: new Date(invoice.TxnDate),
                amount: receivedAmount
              };
            }),
          
          // Recent expenses
          ...currentExpenses.map(expense => {
            return {
              id: expense.Id,
              type: 'EXPENSE_PAID',
              description: expense.PaymentType 
                ? `Paid ${expense.PaymentType} to ${expense.EntityRef?.name || 'Vendor'}` 
                : `Expense paid to ${expense.EntityRef?.name || 'Vendor'}`,
              date: new Date(expense.TxnDate),
              amount: -parseFloat(expense.TotalAmt || '0') // Negative for expenses
            };
          })
        ].sort((a, b) => b.date.getTime() - a.date.getTime())
         .slice(0, 5); // Get most recent 5 activities
        
        // Calculate cash change percentage by comparing current cash flow to previous month's cash flow
        // This properly represents the month-to-month change in cash flow
        const currentCashFlow = currentIncome - currentExpensesTotal;
        const prevCashFlow = prevIncome - prevExpensesTotal;
        
        // Calculate proper percentage change
        const cashChangePercentage = prevCashFlow === 0 
          ? (currentCashFlow > 0 ? 100 : 0)
          : Math.round((currentCashFlow - prevCashFlow) / Math.abs(prevCashFlow) * 100);
        
        // Assemble and return the dashboard data
        console.log(`✅ [QB CONTROLLER] Dashboard data assembled successfully!`);
        return {
          cash: { 
            balance: cashBalance, 
            changePercentage: cashChangePercentage
          },
          income: { 
            mtd: currentIncome, 
            changePercentage: incomeChangePercentage 
          },
          expenses: { 
            mtd: currentExpensesTotal, 
            changePercentage: expensesChangePercentage 
          },
          profitLoss: { 
            mtd: currentProfitLoss, 
            changePercentage: profitLossChangePercentage 
          },
          recentActivity,
          cashFlow: cashFlowData,
          topCustomers,
          topExpenseCategories,
          source: 'quickbooks'
        };
      } catch (apiError) {
        console.error(`❌ [QB CONTROLLER] Error in QuickBooks API calls:`, apiError);
        if (apiError instanceof Error) {
          console.error('Error name:', apiError.name);
          console.error('Error message:', apiError.message);
          console.error('Error stack:', apiError.stack);
          
          // Additional detailed logging of the error
          if ('statusCode' in apiError) {
            console.error('Error status code:', (apiError as any).statusCode);
          }
          
          // For query syntax errors specifically
          if (apiError.message.includes('parsing query') || apiError.message.includes('query')) {
            console.error('⚠️ [QB CONTROLLER] Query syntax error detected. Please check the QuickBooks API documentation for proper query format.');
            console.error('⚠️ [QB CONTROLLER] Suggestion: Try simplifying the query or using different syntax.');
            
            // If we're in development, try a simple test query to see if the API is responsive
            if (process.env.NODE_ENV === 'development') {
              try {
                console.log('🧪 [QB CONTROLLER] Attempting simple test query...');
                // Use a basic query format that is well-documented in QuickBooks API docs
                const testQuery = "SELECT * FROM CompanyInfo";
                await quickbooksApiClient.query(organizationId, realmId, testQuery);
                console.log('✅ [QB CONTROLLER] Test query succeeded, issue is with specific query syntax');
              } catch (testError) {
                console.error('❌ [QB CONTROLLER] Test query also failed, may be connection or authentication issue', testError);
              }
            }
          }
        }
        
        // Re-throw the error so it can be properly handled by the route handler
        throw new ApiError(500, `QuickBooks API error: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`);
      }
    } catch (error) {
      console.error(`❌ [QB CONTROLLER] Error in getDashboardData:`, error);
      if (error instanceof ApiError) {
        throw error; // Rethrow ApiErrors as is
      } else {
        // Wrap other errors in ApiError
        throw new ApiError(
          500, 
          `Error getting QuickBooks dashboard data: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }
}

// Export singleton instance
export const quickbooksDashboardController = new QuickbooksDashboardController(); 