import { prisma } from "../../utils/prisma";
import { ApiError } from "../../utils/errors";
import { quickbooksApiClient } from "../../services/quickbooks/quickbooksApiClient";

/**
 * Controller for fetching a cash-based dashboard from QuickBooks.
 * Demonstrates a single multi-column P&L report for multiple months.
 */
class QuickbooksDashboardController {
  /**
   * Main entry point: gets the dashboard data in cash basis using multi-month P&L.
   */
  async getDashboardData(organizationId: string) {
    try {
      // 1. Ensure we have an active QBO connection
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId },
      });
      if (!connection || !connection.isActive) {
        throw new ApiError(400, "No active QuickBooks connection");
      }
      const realmId = connection.realmId;

      // 2. Calculate relevant date ranges
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);

      // Format function for QBO
      const formatQBDate = (date: Date) => date.toISOString().split("T")[0];

      // 3. Fetch multi-column P&L for the last 6 months (cash basis)
      //    This single call should return multiple columns, one per month + a "Total" column.
      const plParams = {
        start_date: formatQBDate(sixMonthsAgo), // e.g. 6 months back
        end_date: formatQBDate(currentMonthEnd), // up to current month end
        accounting_method: "Cash",
        minorversion: "65",

        // Key param: columns by Month. 
        // In some QBO docs, you may see `column=Month` or `columns=Month` or `displaycolumns=month`.
        // Adjust as needed if the QuickBooks library requires a different key name.
        column: "Month", 
      };

      const multiMonthPLReport = await quickbooksApiClient.getReport(
        organizationId,
        realmId,
        "ProfitAndLoss",
        plParams
      );

      // 4. Parse the multi-month P&L into a structured array
      const monthlyPLData = this.parseMultiMonthProfitAndLoss(multiMonthPLReport);

      // ------------------------------------------------------------------
      // The array "monthlyPLData" typically goes oldest -> newest month.
      // For example:
      // [
      //   { start: '2023-09-01', end: '2023-09-30', label: 'Sep 2023', income: 5000, expenses: 3000, netIncome: 2000 },
      //   { start: '2023-10-01', end: '2023-10-31', label: 'Oct 2023', ... },
      //   ...
      //   { start: '2024-02-01', end: '2024-02-29', label: 'Feb 2024', income: 9000, expenses: 7000, netIncome: 2000 }
      // ]
      // The last entry is presumably the "current month", 
      // the second-to-last is the "previous month".
      // ------------------------------------------------------------------

      if (!monthlyPLData.length) {
        throw new ApiError(400, "No monthly data returned from P&L");
      }

      // Identify the current and previous months in that array
      const currentMonthPL = monthlyPLData[monthlyPLData.length - 1]; // last
      const prevMonthPL = monthlyPLData.length > 1
        ? monthlyPLData[monthlyPLData.length - 2]
        : null; // second-to-last if we have it

      // Extract the final current month's Income, Expenses, Profit
      const currentIncome = currentMonthPL.income;
      const currentExpenses = currentMonthPL.expenses;
      const currentProfitLoss = currentMonthPL.netIncome;

      // If we have a previous month
      let prevIncome = 0, prevExpenses = 0, prevProfitLoss = 0;
      if (prevMonthPL) {
        prevIncome = prevMonthPL.income;
        prevExpenses = prevMonthPL.expenses;
        prevProfitLoss = prevMonthPL.netIncome;
      }

      // 5. Fetch the current month & previous month BalanceSheet (cash basis) for "cash" amounts
      //    (We do this in two calls, one for each month, for an apples-to-apples comparison.)
      const [ cashBalance, prevMonthCashBalance ] = await Promise.all([
        this.fetchCashBalance(
          organizationId,
          realmId,
          currentMonthStart,
          currentMonthEnd
        ),
        this.fetchCashBalance(
          organizationId,
          realmId,
          prevMonthStart,
          prevMonthEnd
        ),
      ]);

      // 6. Compute change percentages
      const incomeChangePercentage = this.percentageChange(prevIncome, currentIncome);
      const expensesChangePercentage = this.percentageChange(prevExpenses, currentExpenses);
      const profitLossChangePercentage = this.percentageChange(
        prevProfitLoss,
        currentProfitLoss,
        true // absolute denominator
      );

      // "cash" change can be based on actual balances from the two BalanceSheets
      let cashChangePercentage = 0;
      if (prevMonthCashBalance > 0) {
        cashChangePercentage = Math.round(
          ((cashBalance - prevMonthCashBalance) / prevMonthCashBalance) * 100
        );
      } else {
        // fallback: compare net incomes
        cashChangePercentage = this.percentageChange(prevProfitLoss, currentProfitLoss, true);
      }

      // 7. Build the final "cash flow" data from the monthly P&L we already have.
      //    This is basically the same as monthlyPLData but renamed "month" for your final structure.
      //    The user wants 6 months, but if QBO returns fewer, we show what we have.
      const cashFlowData = monthlyPLData.map((pl) => ({
        month: pl.label,
        income: pl.income,
        expenses: pl.expenses,
        profit: pl.netIncome,
      }));

      // 8. Fetch current month Invoices + Purchases for recent activity and top customers
      const currentInvoices = await this.fetchInvoices(
        organizationId,
        realmId,
        currentMonthStart,
        currentMonthEnd
      );
      const currentPurchases = await this.fetchPurchases(
        organizationId,
        realmId,
        currentMonthStart,
        currentMonthEnd
      );

      // 9. Build "recent activity" (last 5 items) 
      const customers = await this.fetchAllCustomers(organizationId, realmId);
      const recentActivity = this.buildRecentActivity(currentInvoices, currentPurchases, customers);

      // 10. Build "top customers" by summing paid amounts in the current Invoices
      const topCustomers = this.buildTopCustomers(currentInvoices, customers);

      // 11. Extract top expense categories from the current month's P&L data 
      //    or from the entire multi-month P&L. We'll do "current month" only
      //    by looking at the "Expenses" sub-rows for that column. 
      //    We already have multiMonthPLReport. 
      //    We'll do a dedicated method that tries to parse the P&L rows for the last column only.
      let topExpenseCategories = this.extractExpenseCategoriesForColumn(
        multiMonthPLReport,
        monthlyPLData.length - 1 // index of the last column, ignoring "label" and "total" columns
      );
      if (!topExpenseCategories.length) {
        // fallback to transaction-based grouping if the P&L structure is incomplete
        topExpenseCategories = this.buildExpenseCategoriesFromPurchases(currentPurchases);
      }

      // 12. Profit margin (profit as % of income) for the current month
      let profitMargin = 0;
      if (currentIncome !== 0) {
        profitMargin = Math.round((currentProfitLoss / currentIncome) * 100);
      }

      // Compile final results
      return {
        cash: {
          balance: cashBalance,
          changePercentage: cashChangePercentage,
        },
        income: {
          mtd: currentIncome,
          changePercentage: incomeChangePercentage,
        },
        expenses: {
          mtd: currentExpenses,
          changePercentage: expensesChangePercentage,
        },
        profitLoss: {
          mtd: currentProfitLoss,
          changePercentage: profitLossChangePercentage,
        },
        profitMargin,
        recentActivity,
        cashFlow: cashFlowData,
        topCustomers,
        topExpenseCategories,
        source: "quickbooks",
      };
    } catch (err) {
      console.error(`[QB CONTROLLER] getDashboardData error:`, err);
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(
        500,
        `Error retrieving QuickBooks dashboard data: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ------------------------------------------------------------------
  // Helper: fetch "cash" balance from BalanceSheet (cash basis) 
  // for a given date range.
  // ------------------------------------------------------------------
  private async fetchCashBalance(
    organizationId: string,
    realmId: string,
    startDate: Date,
    endDate: Date
  ) {
    try {
      const params = {
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        accounting_method: "Cash",
        minorversion: "65",
      };
      const bsReport = await quickbooksApiClient.getReport(
        organizationId,
        realmId,
        "BalanceSheet",
        params
      );
      return this.extractCashFromBalanceSheet(bsReport);
    } catch (err) {
      console.warn(`[QB CONTROLLER] BalanceSheet fetch failed; returning 0.`, err);
      return 0;
    }
  }

  // ------------------------------------------------------------------
  // Helper: single multi-month P&L parse method.
  // Returns an array of monthly data: 
  //   [ { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: 'MMM YYYY', income, expenses, netIncome }, ... ]
  // ------------------------------------------------------------------
  private parseMultiMonthProfitAndLoss(report: any) {
    if (!report || !report.Columns?.Column || !report.Rows?.Row) return [];

    const columnInfo = report.Columns.Column; // e.g. array of columns
    const rows = report.Rows.Row;

    // First, figure out how many "month" columns we actually have 
    // (excluding the first label column & possible last "Total" column).
    // Typically:
    //   column[0] = "Account" or "Category" label
    //   column[1..N] = months
    //   column[N+1] = "Total"
    // But we must check the "ColType" or "ColTitle" or "MetaData" to be sure.
    //
    // We'll build an array describing each "month" column: { indexInColData, label, startPeriod, endPeriod, isTotal? }

    const parsedColumns: Array<{
      indexInColData: number;
      label: string;           // e.g. "Sep 2023" 
      startPeriod?: string;    // from MetaData
      endPeriod?: string;      // from MetaData
      isTotal?: boolean;
    }> = [];

    // Start from i=1 because i=0 might be the label column
    for (let i = 1; i < columnInfo.length; i++) {
      const col = columnInfo[i];
      const colTitle = col.ColTitle || "";
      const meta = col.MetaData || [];

      // Try to detect if it's a "Total" column
      const colType = col.ColType || "";
      const maybeIsTotal =
        colType.toLowerCase() === "total" ||
        /total/i.test(colTitle);

      // Some QBO responses mark the "Total" column with a specific "type" or "id" in `MetaData`.
      // We'll do a simpler approach: if the last column's title includes "Total," 
      // or if colType is "Total", we treat it as the total column.
      parsedColumns.push({
        indexInColData: i,
        label: colTitle,
        startPeriod: meta.find((m: any) => m.Name === "StartPeriod")?.Value,
        endPeriod: meta.find((m: any) => m.Name === "EndPeriod")?.Value,
        isTotal: maybeIsTotal,
      });
    }

    // If the very last one is "Total", we ignore it for monthly breakdown
    // So let's separate them into monthly columns vs. total column
    const columnsExcludingTotal = parsedColumns.filter((c) => !c.isTotal);

    // We'll parse Income, Expenses, NetIncome from the P&L rows for each column
    // Then build an array of month-level data
    // QBO typically has a row for "Income", a row for "Expenses", a row for "NetIncome".
    // But sometimes those are sub-rows or labeled differently. We'll handle the group or type checks.

    // We can store the final array of:
    //   { start: string, end: string, label: string, income: number, expenses: number, netIncome: number }
    const result: Array<{
      start: string;
      end: string;
      label: string;
      income: number;
      expenses: number;
      netIncome: number;
    }> = [];

    // For each of the columns (which presumably are in chronological order),
    // we want to see how the "Income" row, "Expenses" row, and "Net Income" row parse out.

    // We'll read the entire row data first
    let incomeRow: any = null;
    let expensesRow: any = null;
    let netIncomeRow: any = null;

    // QBO might produce them as top-level row.group === "Income"/"Expenses"/"NetIncome"
    // or row.type === "Income"/"Expenses"/"NetIncome".
    // Or the "Net Income" might appear as row group "NetOperatingIncome" vs "NetIncome". 
    // We'll do a best-effort find.
    for (const row of rows) {
      const headerVal = row.Header?.ColData?.[0]?.value || "";
      const group = row.group || row.type || "";

      // Income row
      if (
        group === "Income" ||
        headerVal.includes("Total Income") ||
        headerVal === "Income"
      ) {
        incomeRow = row;
      }
      // Expenses row
      if (
        group === "Expenses" ||
        headerVal.includes("Total Expenses") ||
        headerVal === "Expenses"
      ) {
        expensesRow = row;
      }
      // Net Income row
      if (
        group === "NetIncome" ||
        headerVal.includes("Net Income") ||
        headerVal === "NetIncome"
      ) {
        netIncomeRow = row;
      }
    }

    // We'll parse each monthly column
    for (const colDef of columnsExcludingTotal) {
      const incomeVal = this.getAmountFromRowAndCol(incomeRow, colDef.indexInColData);
      const expenseVal = this.getAmountFromRowAndCol(expensesRow, colDef.indexInColData);
      let netVal = this.getAmountFromRowAndCol(netIncomeRow, colDef.indexInColData);

      // If netVal is 0 and we have income/expenses, compute it
      if (netVal === 0 && (incomeVal !== 0 || expenseVal !== 0)) {
        netVal = incomeVal - expenseVal;
      }

      result.push({
        start: colDef.startPeriod || "",
        end: colDef.endPeriod || "",
        label: colDef.label || "Period",
        income: incomeVal,
        expenses: expenseVal,
        netIncome: netVal,
      });
    }

    return result;
  }

  // Helper to read a numeric value from a row's "Summary.ColData[i]" 
  // or from row.ColData (depending on QBO structure).
  private getAmountFromRowAndCol(row: any, colIndex: number) {
    if (!row) return 0;

    // Some rows hold the numeric data in row.Summary.ColData
    // Others hold them in row.ColData. 
    // Usually, for a "group" row (like "Income" with a summary), it's row.Summary.ColData
    // For a line item row, it's row.ColData. 
    // We'll check Summary first, fallback to ColData.
    let valStr: string | undefined;

    if (row.Summary?.ColData?.[colIndex]?.value) {
      valStr = row.Summary.ColData[colIndex].value;
    } else if (row.ColData?.[colIndex]?.value) {
      valStr = row.ColData[colIndex].value;
    }

    const val = parseFloat(valStr || "0");
    return isNaN(val) ? 0 : val;
  }

  // ------------------------------------------------------------------
  // Extract the "cash" (bank accounts, etc.) from a BalanceSheet (cash).
  // ------------------------------------------------------------------
  private extractCashFromBalanceSheet(report: any): number {
    if (!report?.Rows?.Row) return 0;
    const rows = report.Rows.Row;
    let totalCash = 0;

    // Typically, we look for the "Assets" > "Current Assets" > "Bank Accounts"
    const assetsSection = rows.find(
      (r: any) =>
        r.group === "Assets" ||
        (r.Header?.ColData?.[0]?.value === "Assets")
    );
    if (!assetsSection?.Rows?.Row) return 0;

    const currentAssets = assetsSection.Rows.Row.find(
      (r: any) =>
        r.group === "CurrentAssets" ||
        (r.Header?.ColData?.[0]?.value === "Current Assets")
    );
    if (!currentAssets?.Rows?.Row) return 0;

    // 1) Try the "Bank Accounts" group
    const bankSection = currentAssets.Rows.Row.find(
      (r: any) =>
        r.group === "BankAccounts" ||
        (r.Header?.ColData?.[0]?.value === "Bank Accounts")
    );
    if (bankSection?.Summary?.ColData) {
      const valCol = bankSection.Summary.ColData.find(
        (c: any) => c.value && !isNaN(parseFloat(c.value))
      );
      if (valCol) {
        totalCash = parseFloat(valCol.value);
      }
    }

    // 2) If we still have 0, look for any row containing "cash" or "bank"
    if (totalCash === 0) {
      currentAssets.Rows.Row.forEach((r: any) => {
        if (r.ColData?.length > 1) {
          const name = r.ColData[0].value?.toLowerCase() || "";
          const amt = parseFloat(r.ColData[1].value || "0");
          if ((name.includes("cash") || name.includes("bank")) && !isNaN(amt)) {
            totalCash += amt;
          }
        }
      });
    }

    return totalCash;
  }

  // ------------------------------------------------------------------
  // Query Invoices in a given date range
  // ------------------------------------------------------------------
  private async fetchInvoices(
    organizationId: string,
    realmId: string,
    startDate: Date,
    endDate: Date
  ) {
    const query = `
      SELECT * 
      FROM Invoice 
      WHERE TxnDate >= '${startDate.toISOString().split("T")[0]}' 
        AND TxnDate <= '${endDate.toISOString().split("T")[0]}'
    `;
    const response = await quickbooksApiClient.query(organizationId, realmId, query);
    return response.QueryResponse.Invoice || [];
  }

  // ------------------------------------------------------------------
  // Query Purchases in a given date range
  // ------------------------------------------------------------------
  private async fetchPurchases(
    organizationId: string,
    realmId: string,
    startDate: Date,
    endDate: Date
  ) {
    const query = `
      SELECT * 
      FROM Purchase
      WHERE TxnDate >= '${startDate.toISOString().split("T")[0]}'
        AND TxnDate <= '${endDate.toISOString().split("T")[0]}'
    `;
    const response = await quickbooksApiClient.query(organizationId, realmId, query);
    return response.QueryResponse.Purchase || [];
  }

  // ------------------------------------------------------------------
  // Fetch all customers (used for naming in "recent activity" or "top customers")
  // ------------------------------------------------------------------
  private async fetchAllCustomers(organizationId: string, realmId: string) {
    const query = `SELECT * FROM Customer`;
    const response = await quickbooksApiClient.query(organizationId, realmId, query);
    return response.QueryResponse.Customer || [];
  }

  // ------------------------------------------------------------------
  // Build "recent activity" from invoices and purchases 
  // Return the last 5 sorted by TxnDate desc
  // ------------------------------------------------------------------
  private buildRecentActivity(invoices: any[], purchases: any[], customers: any[]) {
    const activities = [
      ...invoices
        .filter((inv) => {
          const total = parseFloat(inv.TotalAmt || "0");
          const balance = parseFloat(inv.Balance || "0");
          return total - balance > 0; // partially or fully paid
        })
        .map((invoice) => {
          const paidAmt = parseFloat(invoice.TotalAmt || "0") - parseFloat(invoice.Balance || "0");
          const custName = invoice.CustomerRef
            ? customers.find((c) => c.Id === invoice.CustomerRef.value)?.DisplayName || "Customer"
            : "Customer";
          const isFullyPaid = parseFloat(invoice.Balance || "0") === 0;
          const status = isFullyPaid ? "fully" : "partially";

          return {
            id: invoice.Id,
            type: "INVOICE_PAID",
            description: `Invoice #${invoice.DocNumber || ""} ${status} paid by ${custName}`,
            date: new Date(invoice.TxnDate),
            amount: paidAmt,
          };
        }),
      ...purchases.map((pur) => {
        const payeeName = pur.EntityRef?.name || "Vendor";
        return {
          id: pur.Id,
          type: "EXPENSE_PAID",
          description: pur.PaymentType
            ? `Paid ${pur.PaymentType} to ${payeeName}`
            : `Expense paid to ${payeeName}`,
          date: new Date(pur.TxnDate),
          amount: -parseFloat(pur.TotalAmt || "0"),
        };
      }),
    ];

    // Sort by date desc, take last 5
    return activities
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);
  }

  // ------------------------------------------------------------------
  // Build "top customers" from the paid portion of Invoices
  // ------------------------------------------------------------------
  private buildTopCustomers(invoices: any[], customers: any[]) {
    const revenueMap = new Map<string, { id: string; name: string; revenue: number }>();
    for (const inv of invoices) {
      if (inv.CustomerRef) {
        const cid = inv.CustomerRef.value;
        if (!revenueMap.has(cid)) {
          const cust = customers.find((c) => c.Id === cid);
          revenueMap.set(cid, {
            id: cid,
            name: cust ? cust.DisplayName || "Customer" : "Customer",
            revenue: 0,
          });
        }
        const paidAmt = parseFloat(inv.TotalAmt || "0") - parseFloat(inv.Balance || "0");
        revenueMap.get(cid)!.revenue += paidAmt;
      }
    }

    return Array.from(revenueMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }

  // ------------------------------------------------------------------
  // Extract top expense categories from the "Expenses" row in a multi-column P&L
  // for a specific column index (e.g. the last column for "current month").
  // If the user wants the entire multi-month total, you could pick the "Total" column 
  // instead. This example just picks the final monthly column.
  // ------------------------------------------------------------------
  private extractExpenseCategoriesForColumn(report: any, colIndex: number) {
    // We'll look for the top-level "Expenses" row, 
    // then each subRow with a label and a numeric value in colIndex.
    const results: Array<{ category: string; amount: number }> = [];
    if (!report?.Rows?.Row) return results;

    // Find the "Expenses" group
    const expensesRow = report.Rows.Row.find(
      (r: any) =>
        r.group === "Expenses" ||
        r.Header?.ColData?.[0]?.value === "Expenses" ||
        (r.Header?.ColData?.[0]?.value || "").includes("Total Expenses")
    );
    if (!expensesRow?.Rows?.Row) {
      return results;
    }

    // In that group, each subRow might be a category line with "ColData"
    // We'll read colData[0] for the category name, colData[colIndex] for the numeric
    for (const subRow of expensesRow.Rows.Row) {
      // Some subRows might have their own .Rows -> indicates subcategories
      if (subRow.ColData?.length > colIndex) {
        const catName = subRow.ColData[0].value || "";
        if (catName.toLowerCase().includes("total")) {
          continue; // skip "Total" lines
        }
        const valStr = subRow.ColData[colIndex]?.value || "0";
        const valNum = parseFloat(valStr);
        if (!isNaN(valNum) && valNum !== 0) {
          results.push({ category: catName, amount: valNum });
        }
      }

      // If there's a nested .Rows, parse them similarly
      if (subRow.Rows?.Row) {
        for (const nestedRow of subRow.Rows.Row) {
          if (nestedRow.ColData?.length > colIndex) {
            const catName = nestedRow.ColData[0].value || "";
            if (catName.toLowerCase().includes("total")) {
              continue;
            }
            const valStr = nestedRow.ColData[colIndex]?.value || "0";
            const valNum = parseFloat(valStr);
            if (!isNaN(valNum) && valNum !== 0) {
              results.push({ category: catName, amount: valNum });
            }
          }
        }
      }
    }

    // Sort descending, top 5
    return results.sort((a, b) => b.amount - a.amount).slice(0, 5);
  }

  // ------------------------------------------------------------------
  // If we fail to parse P&L for categories, fallback: group from Purchases
  // ------------------------------------------------------------------
  private buildExpenseCategoriesFromPurchases(purchases: any[]) {
    const map = new Map<string, { category: string; amount: number }>();
    for (const p of purchases) {
      const catId = p.AccountRef?.value || "Uncategorized";
      const catName = p.AccountRef?.name || "Uncategorized";
      if (!map.has(catId)) {
        map.set(catId, { category: catName, amount: 0 });
      }
      map.get(catId)!.amount += parseFloat(p.TotalAmt || "0");
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }

  // ------------------------------------------------------------------
  // Utility: compute percentage change
  // (newVal - oldVal) / |oldVal| * 100 if absDenominator = true
  // ------------------------------------------------------------------
  private percentageChange(oldVal: number, newVal: number, absDenominator = false) {
    if (oldVal === 0) {
      return newVal > 0 ? 100 : newVal < 0 ? -100 : 0;
    }
    const denom = absDenominator ? Math.abs(oldVal) : oldVal;
    return Math.round(((newVal - oldVal) / denom) * 100);
  }
}

// Export a singleton instance
export const quickbooksDashboardController = new QuickbooksDashboardController();
