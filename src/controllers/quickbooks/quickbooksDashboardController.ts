import { prisma } from "../../utils/prisma";
import { ApiError } from "../../utils/errors";
import { quickbooksApiClient } from "../../services/quickbooks/quickbooksApiClient";
import { quickbooksAuthService } from "../../services/quickbooks/quickbooksAuthService";

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
        where: { organizationId },
      });

      if (!connection || !connection.isActive) {
        console.log(`❌ [QB CONTROLLER] No active connection found for organization: ${organizationId}`);
        throw new ApiError(400, "No active QuickBooks connection");
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
        return date.toISOString().split("T")[0];
      };

      console.log(`📅 [QB CONTROLLER] Query date ranges prepared: 
        Current: ${formatQBDate(startDate)} to ${formatQBDate(endDate)}
        Previous: ${formatQBDate(prevMonthStart)} to ${formatQBDate(prevMonthEnd)}
        Six months ago: ${formatQBDate(sixMonthsAgo)}`);

      // Fetch relevant data from QuickBooks
      // 1. Cash Balance - using BalanceSheet report for more accuracy
      try {
        console.log(`💼 [QB CONTROLLER] Fetching BalanceSheet report for cash balance...`);

        const balanceSheetParams = {
          start_date: formatQBDate(startDate),
          end_date: formatQBDate(endDate),
          accounting_method: "Accrual",
          minorversion: "65",
        };

        let balanceSheetReport;
        try {
          balanceSheetReport = await quickbooksApiClient.getReport(organizationId, realmId, "BalanceSheet", balanceSheetParams);

          console.log(`💰 [QB CONTROLLER] BalanceSheet report fetched successfully.`);
          // Debug balance sheet structure
          console.log(`💰 [QB DEBUG] BalanceSheet structure:`, JSON.stringify(balanceSheetReport).substring(0, 500) + "...");
        } catch (err) {
          console.warn(`⚠️ [QB CONTROLLER] Could not fetch BalanceSheet report, using account queries as fallback.`, err);
          balanceSheetReport = null;
        }

        // Extract cash balance from balance sheet if available
        let cashBalance = 0;
        if (balanceSheetReport && balanceSheetReport.Rows && balanceSheetReport.Rows.Row) {
          const rows = balanceSheetReport.Rows.Row;

          // Look for Assets section
          const assetsSection = rows.find(
            (row) => row.group === "Assets" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Assets")
          );

          if (assetsSection && assetsSection.Rows && assetsSection.Rows.Row) {
            // Find Current Assets section
            const currentAssetsSection = assetsSection.Rows.Row.find(
              (row) => row.group === "CurrentAssets" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Current Assets")
            );

            if (currentAssetsSection && currentAssetsSection.Rows && currentAssetsSection.Rows.Row) {
              // Look for Bank Accounts or Cash accounts
              const bankSection = currentAssetsSection.Rows.Row.find(
                (row) => row.group === "BankAccounts" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Bank Accounts")
              );

              if (bankSection && bankSection.Summary && bankSection.Summary.ColData) {
                const bankValueCol = bankSection.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
                if (bankValueCol) {
                  cashBalance = parseFloat(bankValueCol.value);
                  console.log(`💰 [QB CONTROLLER] Found cash balance from BalanceSheet: ${cashBalance}`);
                }
              }

              // If not found via BankAccounts structure, try direct cash account rows
              if (cashBalance === 0) {
                // Manually look for cash/bank accounts at current assets level
                currentAssetsSection.Rows.Row.forEach((row) => {
                  if (row.ColData && row.ColData.length > 1) {
                    const accountName = row.ColData[0].value || "";
                    if (accountName.toLowerCase().includes("cash") || accountName.toLowerCase().includes("bank")) {
                      const accountBalance = parseFloat(row.ColData[1].value || "0");
                      if (!isNaN(accountBalance)) {
                        cashBalance += accountBalance;
                        console.log(`💰 [QB CONTROLLER] Adding cash account '${accountName}': ${accountBalance}`);
                      }
                    }
                  }
                });
              }
            }
          }
        }

        // If we couldn't extract from the balance sheet, fallback to account queries
        if (cashBalance === 0) {
          console.log(`💼 [QB CONTROLLER] Using account queries fallback for cash balance...`);
          // According to QuickBooks API docs, use single quotes for string literals
          const cashAccountsQuery = "SELECT * FROM Account WHERE AccountType = 'Bank'";
          const cashAccountsResponse = await quickbooksApiClient.query(organizationId, realmId, cashAccountsQuery);
          const cashAccounts = cashAccountsResponse.QueryResponse.Account || [];
          console.log(`💰 [QB CONTROLLER] Found ${cashAccounts.length} cash accounts`);

          // If successful, try to get other current assets in a separate query
          if (cashAccounts.length >= 0) {
            console.log(`💼 [QB CONTROLLER] Querying other current assets...`);
            const otherAssetsQuery = "SELECT * FROM Account WHERE AccountType = 'Other Current Asset'";
            const otherAssetsResponse = await quickbooksApiClient.query(organizationId, realmId, otherAssetsQuery);
            const otherAssets = otherAssetsResponse.QueryResponse.Account || [];
            console.log(`💰 [QB CONTROLLER] Found ${otherAssets.length} other current assets`);

            // Combine the results
            cashAccounts.push(...otherAssets);
          }

          // Calculate cash balance from accounts
          cashBalance = cashAccounts.reduce((sum, account) => sum + parseFloat(account.CurrentBalance || "0"), 0);
        }

        // Query for Income accounts
        // NOTE: This is often incomplete if you rely on the 'CurrentBalance' alone for tracking total recognized income.
        //       The better approach is either to:
        //       1) Use the ProfitAndLoss report for a date range
        //       2) Also consider sub-types like 'Discount Income', 'Unapplied Cash Payment Income', etc.
        console.log(`💼 [QB CONTROLLER] Querying Income accounts...`);
        const incomeAccountsQuery = "SELECT * FROM Account WHERE AccountType IN ('Income', 'Other Income')";
        const incomeAccountsResponse = await quickbooksApiClient.query(organizationId, realmId, incomeAccountsQuery);
        const incomeAccounts = incomeAccountsResponse.QueryResponse.Account || [];
        console.log(`💰 [QB CONTROLLER] Found ${incomeAccounts.length} income accounts`);

        // 2. Current month invoices
        console.log(`📄 [QB CONTROLLER] Querying current month invoices...`);
        const currentInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(startDate)}' AND TxnDate <= '${formatQBDate(endDate)}'`;
        const currentInvoicesResponse = await quickbooksApiClient.query(organizationId, realmId, currentInvoicesQuery);
        const currentInvoices = currentInvoicesResponse.QueryResponse.Invoice || [];
        console.log(`📊 [QB CONTROLLER] Found ${currentInvoices.length} current month invoices`);

        // 3. Previous month invoices
        console.log(`📄 [QB CONTROLLER] Querying previous month invoices...`);
        const prevInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(prevMonthStart)}' AND TxnDate <= '${formatQBDate(
          prevMonthEnd
        )}'`;
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
        const prevExpensesQuery = `SELECT * FROM Purchase WHERE TxnDate >= '${formatQBDate(prevMonthStart)}' AND TxnDate <= '${formatQBDate(
          prevMonthEnd
        )}'`;
        const prevExpensesResponse = await quickbooksApiClient.query(organizationId, realmId, prevExpensesQuery);
        const prevExpenses = prevExpensesResponse.QueryResponse.Purchase || [];
        console.log(`📊 [QB CONTROLLER] Found ${prevExpenses.length} previous month expenses`);

        // 6. Cash flow data (last 6 months) - Invoices + Purchases
        console.log(`📈 [QB CONTROLLER] Querying six month invoices...`);
        const sixMonthInvoicesQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${formatQBDate(sixMonthsAgo)}' AND TxnDate <= '${formatQBDate(
          endDate
        )}'`;
        const sixMonthInvoicesResponse = await quickbooksApiClient.query(organizationId, realmId, sixMonthInvoicesQuery);
        const sixMonthInvoices = sixMonthInvoicesResponse.QueryResponse.Invoice || [];
        console.log(`📊 [QB CONTROLLER] Found ${sixMonthInvoices.length} six month invoices`);

        console.log(`📉 [QB CONTROLLER] Querying six month expenses...`);
        const sixMonthExpensesQuery = `SELECT * FROM Purchase WHERE TxnDate >= '${formatQBDate(sixMonthsAgo)}' AND TxnDate <= '${formatQBDate(
          endDate
        )}'`;
        const sixMonthExpensesResponse = await quickbooksApiClient.query(organizationId, realmId, sixMonthExpensesQuery);
        const sixMonthExpenses = sixMonthExpensesResponse.QueryResponse.Purchase || [];
        console.log(`📊 [QB CONTROLLER] Found ${sixMonthExpenses.length} six month expenses`);

        // 7. Customers for top customers
        console.log(`👥 [QB CONTROLLER] Querying customers...`);
        const customersQuery = `SELECT * FROM Customer`;
        const customersResponse = await quickbooksApiClient.query(organizationId, realmId, customersQuery);
        const customers = customersResponse.QueryResponse.Customer || [];
        console.log(`📊 [QB CONTROLLER] Found ${customers.length} customers`);

        /**
         * -----------------------------------------------------------------
         * NEW/CHANGED: Optionally fetch SalesReceipts for the current month
         * (they are sometimes used instead of Invoices for immediate sales).
         * -----------------------------------------------------------------
         */
        console.log(`📄 [QB CONTROLLER] Querying current month sales receipts...`);
        const currentSalesReceiptsQuery = `SELECT * FROM SalesReceipt WHERE TxnDate >= '${formatQBDate(startDate)}' AND TxnDate <= '${formatQBDate(
          endDate
        )}'`;
        const currentSalesReceiptsResponse = await quickbooksApiClient.query(organizationId, realmId, currentSalesReceiptsQuery);
        const currentSalesReceipts = currentSalesReceiptsResponse.QueryResponse.SalesReceipt || [];
        console.log(`📊 [QB CONTROLLER] Found ${currentSalesReceipts.length} current month sales receipts`);

        /**
         * -----------------------------------------------------------------
         * NEW/CHANGED: Use the ProfitAndLoss report for the current month
         * as an example of how to get a broader summary for 'Income'.
         * (Less manual summation + includes SalesReceipts, Invoices, etc.)
         * -----------------------------------------------------------------
         */
        console.log(`📊 [QB CONTROLLER] Querying ProfitAndLoss report for the current month...`);

        // Use the new getReport method with proper parameters
        let profitAndLossReport;
        try {
          const reportParams = {
            start_date: formatQBDate(startDate),
            end_date: formatQBDate(endDate),
            accounting_method: "Accrual",
            minorversion: "65",
          };

          profitAndLossReport = await quickbooksApiClient.getReport(organizationId, realmId, "ProfitAndLoss", reportParams);

          console.log(`📈 [QB CONTROLLER] ProfitAndLoss report fetched successfully.`);
        } catch (err) {
          console.warn(`⚠️ [QB CONTROLLER] Could not fetch ProfitAndLoss report.`, err);
          // This is optional, so we won't throw an error if it fails.
          profitAndLossReport = null;
        }

        // Also fetch previous month's P&L report for better comparison
        let prevMonthPLReport;
        try {
          const prevReportParams = {
            start_date: formatQBDate(prevMonthStart),
            end_date: formatQBDate(prevMonthEnd),
            accounting_method: "Accrual",
            minorversion: "65",
          };

          prevMonthPLReport = await quickbooksApiClient.getReport(organizationId, realmId, "ProfitAndLoss", prevReportParams);

          console.log(`📈 [QB CONTROLLER] Previous month ProfitAndLoss report fetched successfully.`);
        } catch (err) {
          console.warn(`⚠️ [QB CONTROLLER] Could not fetch previous month ProfitAndLoss report.`, err);
          prevMonthPLReport = null;
        }

        // Calculate dashboard metrics
        console.log(`🧮 [QB CONTROLLER] Calculating dashboard metrics...`);

        // Get income from Income accounts (still used as a fallback measure)
        const incomeFromAccounts = incomeAccounts.reduce((sum, account) => {
          const accountBalance = parseFloat(account.CurrentBalance || "0");
          // Income accounts in QuickBooks are often negative; take absolute value.
          return sum + Math.abs(accountBalance);
        }, 0);

        console.log(`💰 [QB CONTROLLER] Calculated fallback income from accounts: ${incomeFromAccounts}`);

        // Current month income from invoices
        const currentIncomeFromInvoices = currentInvoices.reduce((sum, invoice) => {
          const receivedAmount = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
          return sum + receivedAmount;
        }, 0);

        // Current month income from sales receipts
        const currentIncomeFromSalesReceipts = currentSalesReceipts.reduce((sum, sr) => {
          // For a sales receipt, total amount is typically all recognized at once
          return sum + parseFloat(sr.TotalAmt || "0");
        }, 0);

        // Combine them
        const currentIncomeFromTxn = currentIncomeFromInvoices + currentIncomeFromSalesReceipts;

        // If we have the P&L report data, use it. Otherwise, fallback on the manual sum.
        let plIncome = 0;
        let plExpenses = 0;
        let plProfitLoss = 0;

        if (profitAndLossReport && profitAndLossReport.Rows) {
          try {
            console.log(`📊 [QB CONTROLLER] Parsing P&L report data...`);
            console.log(`📊 [QB DEBUG] P&L report structure:`, JSON.stringify(profitAndLossReport).substring(0, 500) + "...");

            // Extract the total income, expenses, and net income from the P&L report
            const rows = profitAndLossReport.Rows.Row || [];

            // Debug full report structure to understand the data format
            rows.forEach((row, index) => {
              console.log(
                `📊 [QB DEBUG] Row ${index}:`,
                JSON.stringify({
                  group: row.group,
                  header: row.Header?.ColData?.[0]?.value,
                  summary: row.Summary?.ColData?.[1]?.value,
                })
              );
            });

            // The P&L report structure typically contains a summary row for Income, Expenses, and Net Income
            // In QuickBooks, this is usually structured with specific sections

            // Look for direct Net Income (profit/loss) first
            const netIncomeRow = rows.find(
              (row) =>
                row.group === "NetIncome" ||
                row.type === "NetIncome" ||
                (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Net Income"))
            );

            if (netIncomeRow && netIncomeRow.Summary && netIncomeRow.Summary.ColData) {
              // The value is typically in the second column (index 1)
              const valueCol = netIncomeRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
              if (valueCol) {
                plProfitLoss = parseFloat(valueCol.value);
                console.log(`📊 [QB CONTROLLER] Found Net Income directly: ${plProfitLoss}`);
              }
            }

            // Look for Total Income section
            const totalIncomeRow = rows.find(
              (row) =>
                row.group === "Income" ||
                row.type === "Income" ||
                (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Total Income"))
            );

            if (totalIncomeRow && totalIncomeRow.Summary && totalIncomeRow.Summary.ColData) {
              const valueCol = totalIncomeRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
              if (valueCol) {
                plIncome = parseFloat(valueCol.value);
                console.log(`📊 [QB CONTROLLER] Found Total Income directly: ${plIncome}`);
              }
            }

            // Look for Total Expenses section
            const totalExpensesRow = rows.find(
              (row) =>
                row.group === "Expenses" ||
                row.type === "Expenses" ||
                (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Total Expenses"))
            );

            if (totalExpensesRow && totalExpensesRow.Summary && totalExpensesRow.Summary.ColData) {
              const valueCol = totalExpensesRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
              if (valueCol) {
                plExpenses = parseFloat(valueCol.value);
                console.log(`📊 [QB CONTROLLER] Found Total Expenses directly: ${plExpenses}`);
              }
            }

            // If we didn't find net income but have both income and expenses, calculate it
            if (plProfitLoss === 0 && plIncome > 0 && plExpenses > 0) {
              plProfitLoss = plIncome - plExpenses;
              console.log(`📊 [QB CONTROLLER] Calculated Net Income: ${plProfitLoss}`);
            }

            // Validate that our numbers add up
            console.log(`📊 [QB CONTROLLER] P&L Validation:
              Income: ${plIncome}
              Expenses: ${plExpenses}
              Profit/Loss: ${plProfitLoss}
              Income - Expenses = ${plIncome - plExpenses}`);

            // Sanity check - if the difference is significant, log a warning
            const calculatedProfit = plIncome - plExpenses;
            if (Math.abs(calculatedProfit - plProfitLoss) > 1) {
              console.warn(`⚠️ [QB CONTROLLER] Profit calculation discrepancy: 
                P&L report profit: ${plProfitLoss}
                Calculated profit: ${calculatedProfit}
                Difference: ${plProfitLoss - calculatedProfit}`);
            }
          } catch (parseError) {
            console.warn(`⚠️ [QB CONTROLLER] Could not parse P&L rows. Fallback to manual sum.`, parseError);
          }
        }

        // Do the same for previous month P&L report if available
        let prevPlIncome = 0;
        let prevPlExpenses = 0;
        let prevPlProfitLoss = 0;

        if (prevMonthPLReport && prevMonthPLReport.Rows) {
          try {
            console.log(`📊 [QB CONTROLLER] Parsing previous month P&L report data...`);

            const rows = prevMonthPLReport.Rows.Row || [];

            for (const row of rows) {
              if (row.Summary && row.Summary.ColData) {
                // Income section
                if (row.group === "Income" || row.header?.label === "Income") {
                  for (const colData of row.Summary.ColData) {
                    if (colData.value && !isNaN(parseFloat(colData.value))) {
                      prevPlIncome = parseFloat(colData.value);
                      console.log(`💰 [QB CONTROLLER] Found previous month Income from P&L: ${prevPlIncome}`);
                      break;
                    }
                  }
                }
                // Expenses section
                else if (row.group === "Expenses" || row.header?.label === "Expenses") {
                  for (const colData of row.Summary.ColData) {
                    if (colData.value && !isNaN(parseFloat(colData.value))) {
                      prevPlExpenses = parseFloat(colData.value);
                      console.log(`💸 [QB CONTROLLER] Found previous month Expenses from P&L: ${prevPlExpenses}`);
                      break;
                    }
                  }
                }
                // Net Income section
                else if (row.group === "NetIncome" || row.header?.label?.includes("Net Income")) {
                  for (const colData of row.Summary.ColData) {
                    if (colData.value && !isNaN(parseFloat(colData.value))) {
                      prevPlProfitLoss = parseFloat(colData.value);
                      console.log(`📊 [QB CONTROLLER] Found previous month Net Income from P&L: ${prevPlProfitLoss}`);
                      break;
                    }
                  }
                }
              }
            }

            // Calculate if not found directly
            if (prevPlProfitLoss === 0 && (prevPlIncome > 0 || prevPlExpenses > 0)) {
              prevPlProfitLoss = prevPlIncome - prevPlExpenses;
              console.log(`🧮 [QB CONTROLLER] Calculated previous month Net Income: ${prevPlProfitLoss}`);
            }
          } catch (parseError) {
            console.warn(`⚠️ [QB CONTROLLER] Could not parse previous month P&L rows.`, parseError);
          }
        }

        // Calculate previous month income from invoices as fallback
        const prevIncomeFromInvoices = prevInvoices.reduce((sum, invoice) => {
          const receivedAmount = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
          return sum + receivedAmount;
        }, 0);

        console.log(`💰 [QB CONTROLLER] Previous month income from invoices (fallback): ${prevIncomeFromInvoices}`);

        // Final "currentIncome" used in the dashboard
        // If the P&L is available and has data, use that. Otherwise, combine the manual approach.
        console.log(`💰 [QB CONTROLLER] Selecting best source for financial metrics...`);

        // For current month metrics
        const currentIncome = plIncome > 0 ? plIncome : currentIncomeFromTxn > 0 ? currentIncomeFromTxn : incomeFromAccounts;

        const currentExpensesTotal =
          plExpenses > 0 ? plExpenses : currentExpenses.reduce((sum, expense) => sum + parseFloat(expense.TotalAmt || "0"), 0);

        const currentProfitLoss = plProfitLoss !== 0 ? plProfitLoss : currentIncome - currentExpensesTotal;

        console.log(`💰 [QB CONTROLLER] Using current month financials:
          Income: ${currentIncome}
          Expenses: ${currentExpensesTotal}
          Profit/Loss: ${currentProfitLoss}`);

        // For previous month metrics
        const prevIncome = prevPlIncome > 0 ? prevPlIncome : prevIncomeFromInvoices > 0 ? prevIncomeFromInvoices : incomeFromAccounts / 12; // Rough fallback

        const prevExpensesTotal =
          prevPlExpenses > 0 ? prevPlExpenses : prevExpenses.reduce((sum, expense) => sum + parseFloat(expense.TotalAmt || "0"), 0);

        const prevProfitLoss = prevPlProfitLoss !== 0 ? prevPlProfitLoss : prevIncome - prevExpensesTotal;

        console.log(`💰 [QB CONTROLLER] Using previous month financials:
          Income: ${prevIncome}
          Expenses: ${prevExpensesTotal}
          Profit/Loss: ${prevProfitLoss}`);

        // Calculate income change percentage
        const incomeChangePercentage = prevIncome === 0 ? 100 : Math.round(((currentIncome - prevIncome) / prevIncome) * 100);

        // Calculate expenses change percentage
        const expensesChangePercentage =
          prevExpensesTotal === 0 ? 100 : Math.round(((currentExpensesTotal - prevExpensesTotal) / prevExpensesTotal) * 100);

        // Calculate profit/loss change percentage
        const profitLossChangePercentage =
          prevProfitLoss === 0 ? 100 : Math.round(((currentProfitLoss - prevProfitLoss) / Math.abs(prevProfitLoss)) * 100);

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
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const formattedMonth = monthNames[monthDate.getMonth()];

          // Try to get P&L data for this month for more accurate cash flow
          let monthIncome = 0;
          let monthExpenses = 0;
          let monthProfit = 0;

          try {
            console.log(`📊 [QB CONTROLLER] Fetching P&L report for ${formattedMonth}...`);
            const monthReportParams = {
              start_date: formatQBDate(monthStart),
              end_date: formatQBDate(monthEnd),
              accounting_method: "Accrual",
              minorversion: "65",
            };

            const monthReport = await quickbooksApiClient.getReport(organizationId, realmId, "ProfitAndLoss", monthReportParams);

            // Parse P&L report for this month
            if (monthReport && monthReport.Rows && monthReport.Rows.Row) {
              const rows = monthReport.Rows.Row;
              console.log(`📊 [QB DEBUG] ${formattedMonth} P&L rows count: ${rows.length}`);

              // Look for direct Net Income (profit/loss) first - most accurate
              const netIncomeRow = rows.find(
                (row) =>
                  row.group === "NetIncome" ||
                  row.type === "NetIncome" ||
                  (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Net Income"))
              );

              if (netIncomeRow && netIncomeRow.Summary && netIncomeRow.Summary.ColData) {
                const valueCol = netIncomeRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
                if (valueCol) {
                  monthProfit = parseFloat(valueCol.value);
                  console.log(`📊 [QB CONTROLLER] Found ${formattedMonth} Net Income directly: ${monthProfit}`);
                }
              }

              // Look for Total Income section
              const totalIncomeRow = rows.find(
                (row) =>
                  row.group === "Income" ||
                  row.type === "Income" ||
                  (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Total Income"))
              );

              if (totalIncomeRow && totalIncomeRow.Summary && totalIncomeRow.Summary.ColData) {
                const valueCol = totalIncomeRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
                if (valueCol) {
                  monthIncome = parseFloat(valueCol.value);
                  console.log(`📊 [QB CONTROLLER] Found ${formattedMonth} Total Income directly: ${monthIncome}`);
                }
              }

              // Look for Total Expenses section
              const totalExpensesRow = rows.find(
                (row) =>
                  row.group === "Expenses" ||
                  row.type === "Expenses" ||
                  (row.Header && row.Header.ColData && row.Header.ColData[0]?.value?.includes("Total Expenses"))
              );

              if (totalExpensesRow && totalExpensesRow.Summary && totalExpensesRow.Summary.ColData) {
                const valueCol = totalExpensesRow.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
                if (valueCol) {
                  monthExpenses = parseFloat(valueCol.value);
                  console.log(`📊 [QB CONTROLLER] Found ${formattedMonth} Total Expenses directly: ${monthExpenses}`);
                }
              }

              // If we didn't find everything but have both income and expenses, calculate profit
              if (monthProfit === 0 && monthIncome > 0 && monthExpenses > 0) {
                monthProfit = monthIncome - monthExpenses;
                console.log(`📊 [QB CONTROLLER] Calculated ${formattedMonth} profit: ${monthProfit}`);
              }

              // Validate monthly calculations
              console.log(`📊 [QB CONTROLLER] ${formattedMonth} validation:
                Income: ${monthIncome}
                Expenses: ${monthExpenses}
                Profit/Loss: ${monthProfit}
                Income - Expenses = ${monthIncome - monthExpenses}`);
            }
          } catch (monthReportError) {
            console.warn(`⚠️ [QB CONTROLLER] Could not fetch P&L for ${formattedMonth}, using transaction data fallback.`, monthReportError);

            // Fallback to transaction data if P&L report fetch failed
            // Filter invoices for this month - removed "Balance === 0" filter to count partial payments
            const monthInvoices = sixMonthInvoices.filter((invoice) => {
              const txnDate = new Date(invoice.TxnDate);
              return txnDate >= monthStart && txnDate <= monthEnd;
            });

            // Filter expenses for this month
            const monthExpenses = sixMonthExpenses.filter((expense) => {
              const txnDate = new Date(expense.TxnDate);
              return txnDate >= monthStart && txnDate <= monthEnd;
            });

            // Summation from Invoices
            monthIncome = monthInvoices.reduce((sum, invoice) => {
              const receivedAmount = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
              return sum + receivedAmount;
            }, 0);

            // A quick fallback if no monthly invoices found, distribute the known YTD income or a fraction
            if (monthIncome === 0) {
              monthIncome = incomeFromAccounts / 6;
            }

            const monthExpensesTotal = monthExpenses.reduce((sum, expense) => sum + parseFloat(expense.TotalAmt || "0"), 0);

            monthProfit = monthIncome - monthExpensesTotal;
          }

          cashFlowData.push({
            month: formattedMonth,
            income: monthIncome,
            expenses: monthExpenses,
            profit: monthProfit,
          });
        }

        // Calculate top customers based on received money (currentInvoices only here)
        console.log(`👤 [QB CONTROLLER] Building top customer data...`);
        const customerRevenue = new Map();

        currentInvoices.forEach((invoice) => {
          if (invoice.CustomerRef) {
            const customerId = invoice.CustomerRef.value;
            if (!customerRevenue.has(customerId)) {
              const customer = customers.find((c) => c.Id === customerId);
              customerRevenue.set(customerId, {
                id: customerId,
                name: customer ? customer.DisplayName || "Customer" : "Customer",
                revenue: 0,
              });
            }
            const customerData = customerRevenue.get(customerId);
            const receivedAmount = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
            customerData.revenue += receivedAmount;
          }
        });

        const topCustomers = Array.from(customerRevenue.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        // Calculate top expense categories (currentExpenses only)
        console.log(`📋 [QB CONTROLLER] Building expense categories data...`);
        const expenseCategories = new Map();

        // First attempt to extract expense categories from the P&L report for better categorization
        if (profitAndLossReport && profitAndLossReport.Rows) {
          try {
            console.log(`📋 [QB CONTROLLER] Analyzing P&L report for expense categories...`);
            const rows = profitAndLossReport.Rows.Row || [];

            // Find the expenses section
            const expensesSection = rows.find((row) => row.group === "Expenses" || (row.header && row.header.label === "Expenses"));

            if (expensesSection && expensesSection.Rows && expensesSection.Rows.Row) {
              // Analyze each expense subcategory
              expensesSection.Rows.Row.forEach((expenseRow) => {
                if (expenseRow.ColData && expenseRow.ColData.length > 1) {
                  const categoryName = expenseRow.ColData[0].value || "Uncategorized";
                  const amountStr = expenseRow.ColData[1].value || "0";

                  // Skip categories with 0 amount or summary rows
                  if (amountStr !== "0" && !categoryName.includes("Total")) {
                    const amount = parseFloat(amountStr);

                    if (!isNaN(amount) && amount > 0) {
                      expenseCategories.set(categoryName, {
                        category: categoryName,
                        amount: amount,
                      });
                    }
                  }
                }
              });
            }
          } catch (error) {
            console.warn(`⚠️ [QB CONTROLLER] Error extracting expense categories from P&L, using transaction fallback.`, error);
          }
        }

        // If we didn't get data from P&L, fall back to transaction data
        if (expenseCategories.size === 0) {
          console.log(`📋 [QB CONTROLLER] Using transaction data for expense categories...`);

          currentExpenses.forEach((expense) => {
            if (expense.AccountRef) {
              const categoryId = expense.AccountRef.value;
              const categoryName = expense.AccountRef.name || "Uncategorized";

              if (!expenseCategories.has(categoryId)) {
                expenseCategories.set(categoryId, {
                  category: categoryName,
                  amount: 0,
                });
              }

              const categoryData = expenseCategories.get(categoryId);
              categoryData.amount += parseFloat(expense.TotalAmt || "0");
            }
          });
        }

        const topExpenseCategories = Array.from(expenseCategories.values())
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5);

        // Generate recent activity based on invoices and expenses
        console.log(`🔄 [QB CONTROLLER] Building recent activity data...`);
        const recentActivity = [
          ...currentInvoices
            .filter((invoice) => parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0") > 0)
            .map((invoice) => {
              const customerName = invoice.CustomerRef
                ? customers.find((c) => c.Id === invoice.CustomerRef.value)?.DisplayName || "Customer"
                : "Customer";
              const receivedAmount = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
              const status = invoice.Balance === 0 ? "fully" : "partially";

              return {
                id: invoice.Id,
                type: "INVOICE_PAID",
                description: `Invoice #${invoice.DocNumber || ""} ${status} paid by ${customerName}`,
                date: new Date(invoice.TxnDate),
                amount: receivedAmount,
              };
            }),
          ...currentExpenses.map((expense) => {
            return {
              id: expense.Id,
              type: "EXPENSE_PAID",
              description: expense.PaymentType
                ? `Paid ${expense.PaymentType} to ${expense.EntityRef?.name || "Vendor"}`
                : `Expense paid to ${expense.EntityRef?.name || "Vendor"}`,
              date: new Date(expense.TxnDate),
              amount: -parseFloat(expense.TotalAmt || "0"), // Negative for expenses
            };
          }),
        ]
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 5); // Most recent 5

        // Calculate cash change percentage
        const currentCashFlow = currentIncome - currentExpensesTotal;
        const prevCashFlow = prevIncome - prevExpensesTotal;
        const cashChangePercentage =
          prevCashFlow === 0 ? (currentCashFlow > 0 ? 100 : 0) : Math.round(((currentCashFlow - prevCashFlow) / Math.abs(prevCashFlow)) * 100);

        // Make sure the profitLoss.mtd value is consistent with income.mtd and expenses.mtd
        let finalProfitLoss = currentProfitLoss;
        if (Math.abs(currentIncome - currentExpensesTotal - currentProfitLoss) > 1) {
          console.warn(`⚠️ [QB CONTROLLER] Fixing profit discrepancy:
            Original profit: ${currentProfitLoss}
            Recalculated: ${currentIncome - currentExpensesTotal}
          `);
          finalProfitLoss = currentIncome - currentExpensesTotal;
        }

        // Validate previous month profit calculation as well
        let finalPrevProfitLoss = prevProfitLoss;
        if (Math.abs(prevIncome - prevExpensesTotal - prevProfitLoss) > 1) {
          console.warn(`⚠️ [QB CONTROLLER] Fixing previous month profit discrepancy:
            Original profit: ${prevProfitLoss}
            Recalculated: ${prevIncome - prevExpensesTotal}
          `);
          finalPrevProfitLoss = prevIncome - prevExpensesTotal;
        }

        // Recalculate profit/loss change percentage with accurate values
        const recalculatedProfitLossChangePercentage =
          finalPrevProfitLoss === 0 ? 100 : Math.round(((finalProfitLoss - finalPrevProfitLoss) / Math.abs(finalPrevProfitLoss)) * 100);

        // Log the final metrics after all reconciliation
        console.log(`📊 [QB CONTROLLER] Final reconciled metrics:
          Current Month:
            Income: ${currentIncome}
            Expenses: ${currentExpensesTotal}
            Reconciled Profit: ${currentProfitLoss}
          
          Previous Month:
            Income: ${prevIncome}
            Expenses: ${prevExpensesTotal}
            Reconciled Profit: ${finalPrevProfitLoss}
            
          Change Percentages:
            Original P&L Change: ${profitLossChangePercentage}%
            Reconciled P&L Change: ${recalculatedProfitLossChangePercentage}%
        `);

        // Log final validation of cash flow data
        console.log(`✅ [QB CONTROLLER] Cash flow data validation:
          First month:
            Month: ${cashFlowData[0]?.month}
            Income: ${cashFlowData[0]?.income}
            Expenses: ${cashFlowData[0]?.expenses}
            Profit: ${cashFlowData[0]?.profit}
        `);

        // And same check for each cash flow month
        cashFlowData.forEach((monthData, index) => {
          if (Math.abs(monthData.income - monthData.expenses - monthData.profit) > 1) {
            console.warn(`⚠️ [QB CONTROLLER] Fixing ${monthData.month} profit discrepancy:
              Original profit: ${monthData.profit}
              Recalculated: ${monthData.income - monthData.expenses}
            `);
            monthData.profit = monthData.income - monthData.expenses;
          }
        });

        // Also fetch previous month's balance sheet for cash comparison
        let prevMonthCashBalance = 0;
        try {
          console.log(`💼 [QB CONTROLLER] Fetching previous month BalanceSheet report...`);

          const prevBalanceSheetParams = {
            start_date: formatQBDate(prevMonthStart),
            end_date: formatQBDate(prevMonthEnd),
            accounting_method: "Accrual",
            minorversion: "65",
          };

          const prevBalanceSheetReport = await quickbooksApiClient.getReport(organizationId, realmId, "BalanceSheet", prevBalanceSheetParams);

          if (prevBalanceSheetReport && prevBalanceSheetReport.Rows && prevBalanceSheetReport.Rows.Row) {
            const rows = prevBalanceSheetReport.Rows.Row;

            // Look for Assets section
            const assetsSection = rows.find(
              (row) => row.group === "Assets" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Assets")
            );

            if (assetsSection && assetsSection.Rows && assetsSection.Rows.Row) {
              // Find Current Assets section
              const currentAssetsSection = assetsSection.Rows.Row.find(
                (row) => row.group === "CurrentAssets" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Current Assets")
              );

              if (currentAssetsSection && currentAssetsSection.Rows && currentAssetsSection.Rows.Row) {
                // Look for Bank Accounts or Cash accounts
                const bankSection = currentAssetsSection.Rows.Row.find(
                  (row) => row.group === "BankAccounts" || (row.Header && row.Header.ColData && row.Header.ColData[0].value === "Bank Accounts")
                );

                if (bankSection && bankSection.Summary && bankSection.Summary.ColData) {
                  const bankValueCol = bankSection.Summary.ColData.find((col) => col.value && !isNaN(parseFloat(col.value)));
                  if (bankValueCol) {
                    prevMonthCashBalance = parseFloat(bankValueCol.value);
                    console.log(`💰 [QB CONTROLLER] Found previous month cash balance from BalanceSheet: ${prevMonthCashBalance}`);
                  }
                }

                // If not found via BankAccounts structure, try direct cash account rows
                if (prevMonthCashBalance === 0) {
                  // Manually look for cash/bank accounts at current assets level
                  currentAssetsSection.Rows.Row.forEach((row) => {
                    if (row.ColData && row.ColData.length > 1) {
                      const accountName = row.ColData[0].value || "";
                      if (accountName.toLowerCase().includes("cash") || accountName.toLowerCase().includes("bank")) {
                        const accountBalance = parseFloat(row.ColData[1].value || "0");
                        if (!isNaN(accountBalance)) {
                          prevMonthCashBalance += accountBalance;
                          console.log(`💰 [QB CONTROLLER] Adding previous month cash account '${accountName}': ${accountBalance}`);
                        }
                      }
                    }
                  });
                }
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ [QB CONTROLLER] Could not fetch previous month BalanceSheet report.`, err);
          prevMonthCashBalance = 0;
        }

        // Calculate profit margin (profit as percentage of income)
        let profitMargin = 0;
        if (finalProfitLoss !== 0 && currentIncome > 0) {
          // For very small income values, profit margin can be extreme and not meaningful
          // If income is very small (less than $100), set a cap on the profit margin to avoid misleading numbers
          if (currentIncome < 100) {
            console.warn(`⚠️ [QB CONTROLLER] Income is very small (${currentIncome}), profit margin would be misleading.`);
            // If profit is negative, cap at -100%, if positive, cap at 100%
            profitMargin = finalProfitLoss < 0 ? -100 : 100;
          } else {
            profitMargin = Math.round((finalProfitLoss / currentIncome) * 100);
          }
          console.log(`📊 [QB CONTROLLER] Calculated profit margin: ${profitMargin}%`);
        } else {
          console.log(`⚠️ [QB CONTROLLER] Cannot calculate profit margin (income: ${currentIncome}, profit: ${finalProfitLoss})`);
          // If income is zero or negative but we have a loss, set to -100%
          if (finalProfitLoss < 0) {
            profitMargin = -100;
            console.log(`📊 [QB CONTROLLER] Using default negative profit margin: ${profitMargin}%`);
          }
        }

        // Calculate a more accurate cash change percentage using balance sheet data
        let improvedCashChangePercentage = 0;
        if (prevMonthCashBalance > 0) {
          improvedCashChangePercentage = Math.round(((cashBalance - prevMonthCashBalance) / prevMonthCashBalance) * 100);
          console.log(`💰 [QB CONTROLLER] Calculated cash change from balance sheets: ${improvedCashChangePercentage}%`);
        } else {
          // Fallback to the original calculation
          const currentCashFlow = finalProfitLoss;
          const prevCashFlow = finalPrevProfitLoss;
          improvedCashChangePercentage =
            prevCashFlow === 0 ? (currentCashFlow > 0 ? 100 : 0) : Math.round(((currentCashFlow - prevCashFlow) / Math.abs(prevCashFlow)) * 100);
        }

        // Assemble and return the dashboard data with final reconciled values
        console.log(`✅ [QB CONTROLLER] Dashboard data assembly complete with reconciled values`);

        return {
          cash: {
            balance: cashBalance,
            changePercentage: improvedCashChangePercentage,
          },
          income: {
            mtd: currentIncome,
            changePercentage: incomeChangePercentage,
          },
          expenses: {
            mtd: currentExpensesTotal,
            changePercentage: expensesChangePercentage,
          },
          profitLoss: {
            mtd: finalProfitLoss,
            changePercentage: recalculatedProfitLossChangePercentage,
          },
          profitMargin, // Add profit margin to the dashboard data
          recentActivity,
          cashFlow: cashFlowData,
          topCustomers,
          topExpenseCategories,
          source: "quickbooks",
        };
      } catch (apiError) {
        console.error(`❌ [QB CONTROLLER] Error in QuickBooks API calls:`, apiError);
        if (apiError instanceof Error) {
          console.error("Error name:", apiError.name);
          console.error("Error message:", apiError.message);
          console.error("Error stack:", apiError.stack);

          if ("statusCode" in apiError) {
            console.error("Error status code:", (apiError as any).statusCode);
          }

          if (apiError.message.includes("parsing query") || apiError.message.includes("query")) {
            console.error("⚠️ [QB CONTROLLER] Query syntax error detected. Check the QuickBooks API documentation.");
            console.error("⚠️ [QB CONTROLLER] Suggestion: Try simplifying the query or using different syntax.");

            if (process.env.NODE_ENV === "development") {
              try {
                console.log("🧪 [QB CONTROLLER] Attempting simple test query...");
                const testQuery = "SELECT * FROM CompanyInfo";
                await quickbooksApiClient.query(organizationId, realmId, testQuery);
                console.log("✅ [QB CONTROLLER] Test query succeeded, issue is with specific query syntax");
              } catch (testError) {
                console.error("❌ [QB CONTROLLER] Test query also failed, may be connection issue", testError);
              }
            }
          }
        }

        throw new ApiError(500, `QuickBooks API error: ${apiError instanceof Error ? apiError.message : "Unknown error"}`);
      }
    } catch (error) {
      console.error(`❌ [QB CONTROLLER] Error in getDashboardData:`, error);
      if (error instanceof ApiError) {
        throw error;
      } else {
        throw new ApiError(500, `Error getting QuickBooks dashboard data: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }
}

// Export singleton instance
export const quickbooksDashboardController = new QuickbooksDashboardController();
