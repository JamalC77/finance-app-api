import { prisma } from "../../utils/prisma";
import { ApiError } from "../../utils/errors";
import { quickbooksApiClient } from "../../services/quickbooks/quickbooksApiClient";
import { forecastService } from "../../services/financial/forecastService";
import { insightsService } from "../../services/financial/insightsRuleEngine";
import { cacheService } from "../../services/cacheService";
import {
  parseMultiMonthProfitAndLoss,
  parseBalanceSheet,
  parseAgedReceivablesReport,
  buildTopCustomersByOutstanding,
  ChartOfAccountsMap, // Assuming helper types/functions are moved/created
  ParsedReportData,
  ParsedBalanceSheet,
  CustomerARDetail,
  calculateCoreMetrics,
  calculateFinancialRatios,
  calculateTrends,
  calculateAging,
  calculateRunway,
  buildRecentActivity, // Assuming these helpers are refined
  buildTopCustomers,
  extractTopExpenseCategories,
} from "../../services/quickbooks/quickbooksReportParser"; // Conceptual: Refactor parsing/calculation logic into separate modules

// Define expected types for clarity (adjust as needed based on actual parsing results)
interface CoreMetrics {
  currentIncome: number;
  currentExpenses: number;
  currentProfitLoss: number;
  cashBalance: number;
  prevMonthCashBalance: number;
  yoyCashBalance?: number;
  totalAR: number;
  totalAP: number;
  totalCOGS: number; // Needed for Gross Profit
  totalOperatingExpenses: number; // Needed for Operating Profit
  totalCurrentAssets: number;
  totalCurrentLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cashChangePercentage: number;
  incomeChangePercentage: number;
  expensesChangePercentage: number;
  profitLossChangePercentage: number;
  dso: number;
  dpo: number;
}

interface FinancialRatios {
  netProfitMargin: number;
  grossProfitMargin: number;
  operatingProfitMargin: number;
  currentRatio: number | null; // Can be null if liabilities are 0
  quickRatio: number | null; // Can be null if liabilities are 0
  workingCapital: number;
  debtToEquity: number | null; // Can be null if equity is 0
}

interface TrendData {
  monthlyPLData: ParsedReportData[]; // 12-24 months
  yoyIncomeChange?: number;
  yoyProfitChange?: number;
  avgMonthlyBurn: number; // Used for runway
  // Add rolling averages, etc. here
}

interface AgingData {
  ar: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
  ap: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
}

// --- Main Controller ---

class QuickbooksDashboardController {
  /**
   * Fetches Chart of Accounts - CRUCIAL for robust parsing.
   * Cache heavily.
   */
  private async fetchChartOfAccounts(
    organizationId: string,
    realmId: string
  ): Promise<ChartOfAccountsMap> {
    const cacheKey = `qbo:coa:${realmId}`;
    let cachedCoA = await cacheService.get<ChartOfAccountsMap>(cacheKey);
    if (cachedCoA) {
        console.log(`[QB CONTROLLER] Using cached Chart of Accounts for realm ${realmId}`);
        return cachedCoA;
    }
    console.log(`[QB CONTROLLER] Fetching fresh Chart of Accounts for realm ${realmId}`);

    try {
      // Ensure MAXRESULTS is high enough or implement pagination if necessary
      const query = `SELECT * FROM Account WHERE Active = true MAXRESULTS 1000`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const accounts = response.QueryResponse.Account || [];

      // Build a map for easy lookup by ID
      const coaMap: ChartOfAccountsMap = new Map();
      accounts.forEach((acc: any) => {
        coaMap.set(acc.Id, {
          id: acc.Id,
          name: acc.Name,
          accountType: acc.AccountType,
          accountSubType: acc.AccountSubType,
          classification: acc.Classification,
        });
      });

      console.log(`[QB CONTROLLER] Fetched ${coaMap.size} active accounts for realm ${realmId}. Caching...`);
      await cacheService.set(cacheKey, coaMap, 3600 * 6); // Cache for 6 hours
      return coaMap;
    } catch (err) {
      console.error(`[QB CONTROLLER] FATAL: Failed to fetch Chart of Accounts for ${realmId}`, err);
      // It's critical, so throw
      throw new ApiError(500, "Failed to retrieve critical Chart of Accounts from QuickBooks.");
    }
  }

  /**
   * Fetches a report with caching.
   */
  private async fetchReportWithCache(
    organizationId: string,
    realmId: string,
    reportName: "ProfitAndLoss" | "BalanceSheet",
    params: Record<string, string>
  ) {
    const paramString = JSON.stringify(params);
    const cacheKey = `qbo:report:${realmId}:${reportName}:${paramString}`;
    let cachedReport = await cacheService.get<any>(cacheKey);
    if (cachedReport) {
        console.log(`[QB CONTROLLER] Using cached report ${reportName} for realm ${realmId}, params: ${paramString}`);
        return cachedReport;
    }
    console.log(`[QB CONTROLLER] Fetching fresh report ${reportName} for realm ${realmId}, params: ${paramString}`);

    try {
      const report = await quickbooksApiClient.getReport(
        organizationId,
        realmId,
        reportName,
        params
      );
      // Basic validation of report structure
      if (!report || !report.Header || !report.Columns || !report.Rows) {
          console.warn(`[QB CONTROLLER] Fetched report ${reportName} for realm ${realmId} seems invalid or empty. Returning null.`);
          await cacheService.set(cacheKey, null, 600); // Cache null result for 10 mins to prevent hammering
          return null;
      }
      console.log(`[QB CONTROLLER] Fetched fresh report ${reportName} successfully for realm ${realmId}. Caching...`);
      await cacheService.set(cacheKey, report, 3600); // Cache for 1 hour
      return report;
    } catch (err) {
      // Log detailed error from QBO if possible
      const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
      console.error(`[QB CONTROLLER] fetchReport ${reportName} failed for realm ${realmId} with params ${paramString}. Error: ${err instanceof Error ? err.message : String(err)}. QBO Detail: ${qboError?.Detail || 'N/A'}. Returning null.`, err);
      await cacheService.set(cacheKey, null, 600); // Cache null result for 10 mins
      return null; // Return null to be checked later
    }
  }

  /** Fetches all open invoices. Cache moderately. */
  private async fetchOpenInvoices(organizationId: string, realmId: string) {
    const cacheKey = `qbo:openinvoices:${realmId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[QB CONTROLLER] Using cached open invoices for realm ${realmId}`);
        return cached;
    }
    console.log(`[QB CONTROLLER] Fetching fresh open invoices for realm ${realmId}`);

    try {
      // TODO: Implement pagination if > 1000 open invoices is likely
      const query = `SELECT * FROM Invoice WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const invoices = response.QueryResponse?.Invoice || []; // Safer access
      console.log(`[QB CONTROLLER] Fetched ${invoices.length} open invoices for realm ${realmId}. Caching...`);
      await cacheService.set(cacheKey, invoices, 1800); // Cache for 30 mins
      return invoices;
    } catch (err) {
      const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
      console.error(`[QB CONTROLLER] Failed to fetch open invoices for ${realmId}. Error: ${err instanceof Error ? err.message : String(err)}. QBO Detail: ${qboError?.Detail || 'N/A'}. Returning empty array.`, err);
      return []; // Return empty, don't fail the whole dashboard
    }
  }

  /** Fetches all open bills. Cache moderately. */
  private async fetchOpenBills(organizationId: string, realmId: string) {
    const cacheKey = `qbo:openbills:${realmId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
        console.log(`[QB CONTROLLER] Using cached open bills for realm ${realmId}`);
        return cached;
    }
    console.log(`[QB CONTROLLER] Fetching fresh open bills for realm ${realmId}`);

     try {
       // TODO: Implement pagination if > 1000 open bills is likely
      const query = `SELECT * FROM Bill WHERE Balance > '0' STARTPOSITION 1 MAXRESULTS 1000`;
      const response = await quickbooksApiClient.query(organizationId, realmId, query);
      const bills = response.QueryResponse?.Bill || []; // Safer access
      console.log(`[QB CONTROLLER] Fetched ${bills.length} open bills for realm ${realmId}. Caching...`);
      await cacheService.set(cacheKey, bills, 1800); // Cache for 30 mins
      return bills;
    } catch (err) {
      const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
      console.error(`[QB CONTROLLER] Failed to fetch open bills for ${realmId}. Error: ${err instanceof Error ? err.message : String(err)}. QBO Detail: ${qboError?.Detail || 'N/A'}. Returning empty array.`, err);
      return []; // Return empty
    }
  }

  /** Fetches Customer data. Cache longer. */
   private async fetchAllCustomers(organizationId: string, realmId: string) {
     const cacheKey = `qbo:customers:${realmId}`;
     const cached = await cacheService.get<any[]>(cacheKey);
     if (cached) {
         console.log(`[QB CONTROLLER] Using cached customers for realm ${realmId}`);
         return cached;
     }
     console.log(`[QB CONTROLLER] Fetching fresh customers for realm ${realmId}`);

      try {
        // TODO: Implement pagination if > 1000 customers is likely
       const query = `SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 1000`;
       const response = await quickbooksApiClient.query(organizationId, realmId, query);
       const customers = response.QueryResponse?.Customer || []; // Safer access
       console.log(`[QB CONTROLLER] Fetched ${customers.length} customers for realm ${realmId}. Caching...`);
       await cacheService.set(cacheKey, customers, 3600 * 4); // Cache for 4 hours
       return customers;
     } catch (err) {
       const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
       console.error(`[QB CONTROLLER] Failed to fetch customers for ${realmId}. Error: ${err instanceof Error ? err.message : String(err)}. QBO Detail: ${qboError?.Detail || 'N/A'}. Returning empty array.`, err);
      return []; // Return empty
    }
  }

  /** Fetches Aged Receivables report for customer-level AR breakdown. Cache moderately. */
  private async fetchAgedReceivablesReport(organizationId: string, realmId: string) {
    const cacheKey = `qbo:agedreceivables:${realmId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      console.log(`[QB CONTROLLER] Using cached AgedReceivables report for realm ${realmId}`);
      return cached;
    }
    console.log(`[QB CONTROLLER] Fetching fresh AgedReceivables report for realm ${realmId}`);

    try {
      const today = new Date();
      const formatQBDate = (date: Date) => date.toISOString().split("T")[0];
      
      const params = {
        report_date: formatQBDate(today),
        minorversion: "75"
      };

      const report = await quickbooksApiClient.getReport(
        organizationId,
        realmId,
        "AgedReceivables",
        params
      );

      // Basic validation
      if (!report || !report.Rows) {
        console.warn(`[QB CONTROLLER] AgedReceivables report for realm ${realmId} seems invalid or empty. Returning null.`);
        await cacheService.set(cacheKey, null, 600); // Cache null for 10 mins
        return null;
      }

      console.log(`[QB CONTROLLER] Fetched fresh AgedReceivables report for realm ${realmId}. Caching...`);
      await cacheService.set(cacheKey, report, 1800); // Cache for 30 mins
      return report;
    } catch (err) {
      const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
      console.error(`[QB CONTROLLER] Failed to fetch AgedReceivables report for ${realmId}. Error: ${err instanceof Error ? err.message : String(err)}. QBO Detail: ${qboError?.Detail || 'N/A'}. Returning null.`, err);
      return null; // Return null, don't fail the whole dashboard
    }
  }


  /**
   * Main entry point: gets enhanced dashboard data.
   */
  async getDashboardData(organizationId: string, options: { accountingMethod?: "Cash" | "Accrual" } = {}) {
    let realmId: string = ''; // Initialize realmId

    try {
      console.log(`[QB CONTROLLER] Starting getDashboardData for org ${organizationId}`);
      // 1. Ensure connection and get Realm ID
      const connection = await prisma.quickbooksConnection.findUnique({
        where: { organizationId },
      });
      if (!connection || !connection.isActive) {
        console.error(`[QB CONTROLLER] No active QuickBooks connection found for org ${organizationId}`);
        throw new ApiError(400, "No active QuickBooks connection");
      }
      realmId = connection.realmId; // Assign realmId
      const accountingMethod = options.accountingMethod || "Cash"; // Default to Cash
      console.log(`[QB CONTROLLER] Using Realm ID: ${realmId}, Accounting Method: ${accountingMethod}`);

      // 2. Date Ranges
      const now = new Date();
      const reportEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of current month
      const reportStartDate = new Date(reportEndDate);
      reportStartDate.setMonth(reportStartDate.getMonth() - 23); // Start ~23 months back for 24 total
      reportStartDate.setDate(1);

      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastYearThisMonthEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);

      const formatQBDate = (date: Date) => date.toISOString().split("T")[0];
      console.log(`[QB CONTROLLER] Report Date Range: ${formatQBDate(reportStartDate)} to ${formatQBDate(reportEndDate)}`);

      // 3. Fetch Core Data Concurrently (using cache)
      console.log(`[QB CONTROLLER] Starting parallel data fetch for realm ${realmId}...`);
      // Fetch CoA first, as it's critical for parsing. Throw if it fails.
      const chartOfAccounts = await this.fetchChartOfAccounts(organizationId, realmId);

      const plParams = {
        start_date: formatQBDate(reportStartDate),
        end_date: formatQBDate(reportEndDate),
        accounting_method: accountingMethod,
        minorversion: "65", // Use a recent minor version
        summarize_column_by: "Month",
      };
      const bsParamsCurrent = { date: formatQBDate(reportEndDate), accounting_method: accountingMethod, minorversion: "65" };
      const bsParamsPrev = { date: formatQBDate(prevMonthEnd), accounting_method: accountingMethod, minorversion: "65" };
      const bsParamsYoY = { date: formatQBDate(lastYearThisMonthEnd), accounting_method: accountingMethod, minorversion: "65" };

      // Fetch remaining data concurrently
      const [
        multiMonthPLReport,
        currentMonthBSReport,
        prevMonthBSReport,
        yoyMonthBSReport,
        openInvoices,
        openBills,
        customers,
        agedReceivablesReport,
      ] = await Promise.all([
        this.fetchReportWithCache(organizationId, realmId, "ProfitAndLoss", plParams),
        this.fetchReportWithCache(organizationId, realmId, "BalanceSheet", bsParamsCurrent),
        this.fetchReportWithCache(organizationId, realmId, "BalanceSheet", bsParamsPrev),
        this.fetchReportWithCache(organizationId, realmId, "BalanceSheet", bsParamsYoY),
        this.fetchOpenInvoices(organizationId, realmId),
        this.fetchOpenBills(organizationId, realmId),
        this.fetchAllCustomers(organizationId, realmId),
        this.fetchAgedReceivablesReport(organizationId, realmId),
      ]);
      console.log(`[QB CONTROLLER] Parallel data fetch completed for realm ${realmId}.`);


      // --- DEBUG LOGGING AND PRE-PARSE CHECKS ---
      console.log('--- [DEBUG] Raw Report Data Start ---');
      // Log key details, avoid logging full PII/financial data in production if possible
      console.log(`[DEBUG] Realm ${realmId}: Raw multiMonthPLReport Status: ${multiMonthPLReport ? 'Fetched' : 'FAILED/NULL'}`);
      if(multiMonthPLReport) {
          console.log(`[DEBUG] Realm ${realmId}: Raw multiMonthPLReport Header:`, JSON.stringify(multiMonthPLReport.Header, null, 2));
          console.log(`[DEBUG] Realm ${realmId}: Raw multiMonthPLReport Row Count:`, multiMonthPLReport.Rows?.Row?.length ?? 0);
      }

      console.log(`[DEBUG] Realm ${realmId}: Raw currentMonthBSReport Status: ${currentMonthBSReport ? 'Fetched' : 'FAILED/NULL'}`);
      if(currentMonthBSReport) {
          console.log(`[DEBUG] Realm ${realmId}: Raw currentMonthBSReport Header:`, JSON.stringify(currentMonthBSReport.Header, null, 2));
          console.log(`[DEBUG] Realm ${realmId}: Raw currentMonthBSReport Row Count:`, currentMonthBSReport.Rows?.Row?.length ?? 0);
      }
      console.log(`[DEBUG] Realm ${realmId}: Chart of Accounts size:`, chartOfAccounts.size);
      console.log('--- [DEBUG] Raw Report Data End ---');

      // Check if essential reports were actually fetched and are valid structures
      if (!multiMonthPLReport || !multiMonthPLReport.Header || !multiMonthPLReport.Rows) {
         console.error(`[QB CONTROLLER] FATAL: Failed to retrieve a valid ProfitAndLoss report structure for realm ${realmId}. Fetch returned null or invalid report.`);
         throw new ApiError(500, "Failed to retrieve essential Profit and Loss report from QuickBooks. Check API connectivity or report parameters.");
      }
       if (!currentMonthBSReport || !currentMonthBSReport.Header || !currentMonthBSReport.Rows) {
         console.error(`[QB CONTROLLER] FATAL: Failed to retrieve a valid current BalanceSheet report structure for realm ${realmId}. Fetch returned null or invalid report.`);
         throw new ApiError(500, "Failed to retrieve essential Balance Sheet report from QuickBooks. Check API connectivity or report parameters.");
      }
      // --- END OF PRE-PARSE CHECKS ---


      // --- Enhanced P&L Row Debugging (Added Here) ---
      if (multiMonthPLReport && multiMonthPLReport.Rows && multiMonthPLReport.Rows.Row) {
          console.log(`[DEBUG] Realm ${realmId}: First few P&L Rows Structure (Max 5 rows):`);
          const rowsToShow = multiMonthPLReport.Rows.Row.slice(0, 5); // Log first 5 rows
          rowsToShow.forEach((row: any, index: number) => {
              console.log(`  [P&L Row ${index}]: Type: ${row.type}, Header?: ${!!row.Header}, Group?: ${row.group}`);
              if (row.Header && row.Header.ColData) {
                  console.log(`    Header Titles: ${row.Header.ColData.map((cd: any) => cd.value).join(' | ')}`);
              } else if (row.ColData) {
                  // Attempt to find a 'title' column (usually the first one)
                  const title = row.ColData[0]?.value || 'N/A';
                  const values = row.ColData.slice(1).map((cd: any) => cd.value).join(' | ');
                  console.log(`    Row Data: Title='${title}', Values='${values}'`);
              } else if (row.Rows && row.Rows.Row) {
                  // This indicates a section/group row
                  console.log(`    Contains Sub-Rows: ${row.Rows.Row.length}, Title: ${row.Summary?.ColData?.[0]?.value || row.Header?.ColData?.[0]?.value || 'N/A'}`);
              } else {
                  console.log(`    Row content structure not immediately recognized:`, JSON.stringify(row)); // Keep it concise
              }
          });
          if (multiMonthPLReport.Rows.Row.length > 5) {
              console.log(`  ... (and ${multiMonthPLReport.Rows.Row.length - 5} more rows)`);
          }
      } else {
           console.log(`[DEBUG] Realm ${realmId}: No P&L Rows found in the raw report structure (multiMonthPLReport.Rows.Row is missing or empty).`);
      }
      // --- End of Enhanced Debugging ---


      // 4. Parse Reports using CoA for robustness
      console.log(`[QB CONTROLLER] Attempting to parse P&L report for realm ${realmId}...`);
      let parsedPLData: ParsedReportData[] | null = null; // Initialize as potentially null
      try {
         parsedPLData = parseMultiMonthProfitAndLoss(multiMonthPLReport, chartOfAccounts);
         // More detailed logging of the result
         console.log(`[QB CONTROLLER] P&L parsing completed for realm ${realmId}. Result type: ${typeof parsedPLData}, IsArray: ${Array.isArray(parsedPLData)}, Length: ${parsedPLData?.length ?? 'N/A'}`);
         if (Array.isArray(parsedPLData) && parsedPLData.length > 0) {
             console.log(`[DEBUG] Realm ${realmId}: First element of parsedPLData:`, JSON.stringify(parsedPLData[0], null, 2));
         } else if (Array.isArray(parsedPLData)) {
             console.warn(`[QB CONTROLLER] P&L Parser for realm ${realmId} returned an EMPTY array. Check the P&L Rows Structure logs above and the parser logic.`);
         } else {
              console.error(`[QB CONTROLLER] P&L Parser for realm ${realmId} returned non-array result:`, parsedPLData);
         }
      } catch (parseError) {
          console.error(`[QB CONTROLLER] *** CRITICAL ERROR during P&L parsing for realm ${realmId}:`, parseError);
          // Decide if this is fatal. For core metrics, it likely is.
          throw new ApiError(500, `Internal error parsing Profit and Loss data: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }


      console.log(`[QB CONTROLLER] Attempting to parse Current BS report for realm ${realmId}...`);
      let parsedCurrentBS: ParsedBalanceSheet | null = null; // Initialize as potentially null
       try {
          parsedCurrentBS = parseBalanceSheet(currentMonthBSReport, chartOfAccounts);
          console.log(`[QB CONTROLLER] Current BS parsing completed for realm ${realmId}. Result is object: ${typeof parsedCurrentBS === 'object' && parsedCurrentBS !== null}`);
       } catch (parseError) {
           console.error(`[QB CONTROLLER] *** CRITICAL ERROR during Current BS parsing for realm ${realmId}:`, parseError);
           throw new ApiError(500, `Internal error parsing Balance Sheet data: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
       }

      // Handle potentially null previous/YoY reports gracefully during parsing
      console.log(`[QB CONTROLLER] Parsing Prev/YoY BS reports for realm ${realmId}...`);
      let parsedPrevBS: ParsedBalanceSheet | null = null;
      let parsedYoYBS: ParsedBalanceSheet | null = null;
       try {
           parsedPrevBS = prevMonthBSReport ? parseBalanceSheet(prevMonthBSReport, chartOfAccounts) : null;
           parsedYoYBS = yoyMonthBSReport ? parseBalanceSheet(yoyMonthBSReport, chartOfAccounts) : null;
           console.log(`[QB CONTROLLER] Prev BS parsed: ${!!parsedPrevBS}, YoY BS parsed: ${!!parsedYoYBS}`);
       } catch (parseError) {
            console.warn(`[QB CONTROLLER] Warning: Error parsing previous or YoY Balance Sheet for realm ${realmId}. Some comparison metrics might be unavailable. Error:`, parseError);
            // Don't necessarily throw, allow dashboard to load with potentially missing comparison data
       }


      // Check parsed data before calculation (Make checks more robust)
      if (!parsedPLData || !Array.isArray(parsedPLData) || parsedPLData.length === 0) {
          console.error(`[QB CONTROLLER] Error for realm ${realmId}: parsedPLData is invalid (null, not an array, or empty) after parsing. Report may be empty or parser failed. Check the detailed P&L row/parser logs above.`);
          // THE ACTUAL FIX NEEDS TO BE IN quickbooksReportParser.ts in the parseMultiMonthProfitAndLoss function
          throw new ApiError(500, "Failed to process Profit and Loss data for metric calculation. Parser returned empty data. Check server logs for details."); // Line 380ish
      }
      if (!parsedCurrentBS || typeof parsedCurrentBS !== 'object') {
           console.error(`[QB CONTROLLER] Error for realm ${realmId}: parsedCurrentBS is invalid (null or not an object) after parsing. Report may be empty or parser failed. Check server logs for details.`);
           // THE ACTUAL FIX NEEDS TO BE IN quickbooksReportParser.ts in the parseBalanceSheet function
           throw new ApiError(500, "Failed to process Balance Sheet data for metric calculation. Parser returned invalid data. Check server logs for details.");
      }
      console.log(`[QB CONTROLLER] Parsed data validation passed for realm ${realmId}. Proceeding to calculations.`);

      // 5. Calculate Metrics, Ratios, Trends, Aging, Runway
      console.log(`[QB CONTROLLER] Calculating core metrics for realm ${realmId}...`);
      // Ensure calculateCoreMetrics handles null prev/yoy gracefully if they failed parsing
      const coreMetrics = calculateCoreMetrics(parsedPLData, parsedCurrentBS, parsedPrevBS, parsedYoYBS);
      console.log(`[QB CONTROLLER] Calculating financial ratios for realm ${realmId}...`);
      // Use optional chaining for safety
      const lastPLData = parsedPLData[parsedPLData.length - 1];
      const ratios = calculateFinancialRatios(coreMetrics, lastPLData?.netIncome || 0);
      console.log(`[QB CONTROLLER] Calculating trends for realm ${realmId}...`);
      const trends = calculateTrends(parsedPLData, coreMetrics); // Ensure this handles potentially short PL data history
      console.log(`[QB CONTROLLER] Calculating aging for realm ${realmId}...`);
      const aging = calculateAging(openInvoices, openBills, coreMetrics.totalAR, coreMetrics.totalAP);
      console.log(`[QB CONTROLLER] Calculating runway for realm ${realmId}...`);
      const runwayMonths = calculateRunway(coreMetrics.cashBalance, trends.avgMonthlyBurn);
      console.log(`[QB CONTROLLER] Core calculations completed for realm ${realmId}.`);

      // 6. Forecasting (Backend Logic)
      console.log(`[QB CONTROLLER] Generating cash flow forecast for realm ${realmId}...`);
      const cashFlowForecast = await forecastService.generateCashFlowForecast({
        historicalPL: trends.monthlyPLData,
        currentAR: aging.ar,
        currentAP: aging.ap,
        currentCash: coreMetrics.cashBalance,
      });
      console.log(`[QB CONTROLLER] Cash flow forecast generated for realm ${realmId}.`);

      // 7. Generate Insights (Backend Logic)
      console.log(`[QB CONTROLLER] Generating insights for realm ${realmId}...`);
      const businessInsights = insightsService.generateInsights({
         metrics: coreMetrics, ratios, trends, aging, runway: runwayMonths, forecast: cashFlowForecast
      });
      console.log(`[QB CONTROLLER] Insights generated for realm ${realmId}.`);

       // 8. Build supporting lists
       console.log(`[QB CONTROLLER] Building supporting lists for realm ${realmId}...`);
      const recentActivity = buildRecentActivity(openInvoices, openBills, customers);
      const topCustomers = buildTopCustomers(openInvoices, customers);
      // extractTopExpenseCategories might need the raw report, ensure it handles potential nulls/empties
      // Also ensure index is valid
      const plLastIndex = parsedPLData.length > 0 ? parsedPLData.length - 1 : -1; // Use -1 if empty
      const topExpenseCategories = multiMonthPLReport && plLastIndex !== -1
          ? extractTopExpenseCategories(multiMonthPLReport, chartOfAccounts, plLastIndex)
          : [];
      
      // 8.1 Build customer-level AR details
      // Try to use the official AgedReceivables report first, fall back to open invoices
      let customerARDetails: CustomerARDetail[] = [];
      if (agedReceivablesReport) {
          console.log(`[QB CONTROLLER] Parsing AgedReceivables report for realm ${realmId}...`);
          customerARDetails = parseAgedReceivablesReport(agedReceivablesReport);
      }
      // Fall back to building from open invoices if report parsing failed or returned empty
      if (customerARDetails.length === 0 && openInvoices.length > 0) {
          console.log(`[QB CONTROLLER] Building customer AR from open invoices for realm ${realmId}...`);
          customerARDetails = buildTopCustomersByOutstanding(openInvoices, customers);
      }
      console.log(`[QB CONTROLLER] Customer AR details: ${customerARDetails.length} customers found.`);
      console.log(`[QB CONTROLLER] Supporting lists built for realm ${realmId}.`);


      // 9. Assemble Final Payload
      console.log(`[QB CONTROLLER] Assembling final dashboard payload for realm ${realmId}.`);
      const dashboardData = {
        // Basic Metrics
        cash: { balance: coreMetrics.cashBalance, changePercentage: coreMetrics.cashChangePercentage },
        income: { mtd: coreMetrics.currentIncome, changePercentage: coreMetrics.incomeChangePercentage },
        expenses: { mtd: coreMetrics.currentExpenses, changePercentage: coreMetrics.expensesChangePercentage },
        profitLoss: { mtd: coreMetrics.currentProfitLoss, changePercentage: coreMetrics.profitLossChangePercentage },

        // Key Ratios & Health
        margins: { netProfitPercent: ratios.netProfitMargin, grossProfitPercent: ratios.grossProfitMargin, operatingProfitPercent: ratios.operatingProfitMargin },
        liquidity: { currentRatio: ratios.currentRatio, quickRatio: ratios.quickRatio, workingCapital: ratios.workingCapital },
        solvency: { debtToEquity: ratios.debtToEquity },
        efficiency: { dso: coreMetrics.dso, dpo: coreMetrics.dpo },
        agingAR: aging.ar,
        agingAP: aging.ap,
        runwayMonths: runwayMonths,

        // Trends
        cashFlowHistory: trends.monthlyPLData,

        // Forecast
        cashFlowForecast: cashFlowForecast,

        // Insights
        businessInsights: businessInsights,

        // Supporting Lists
        recentActivity: recentActivity.slice(0, 5),
        topCustomers: topCustomers.slice(0, 5),
        topExpenseCategories: topExpenseCategories.slice(0, 5),
        
        // Customer-level AR breakdown (top 10 by outstanding amount)
        customerARDetails: customerARDetails.slice(0, 10),

        // Advanced/Detailed Data
        advancedMetrics: {
          accountsReceivable: coreMetrics.totalAR,
          accountsPayable: coreMetrics.totalAP,
          yoyIncomeChange: trends.yoyIncomeChange,
          yoyProfitChange: trends.yoyProfitChange,
          yoyCashBalance: coreMetrics.yoyCashBalance,
        },

        // Metadata
        dataSource: "quickbooks",
        accountingMethod: accountingMethod,
        lastRefreshed: new Date().toISOString(),
      };
      console.log(`[QB CONTROLLER] Dashboard data successfully assembled for org ${organizationId}, realm ${realmId}.`);
      return dashboardData;

    } catch (err) {
      // Ensure realmId is available if the error happened after fetching connection
      const realmInfo = realmId ? ` for realm ${realmId}` : '';
      console.error(`[QB CONTROLLER] *** ERROR in getDashboardData for org ${organizationId}${realmInfo}:`, err instanceof Error ? err.message : String(err), err);

      if (err instanceof ApiError) {
        if ((err as any).details) {
          console.error('[QB CONTROLLER] QuickBooks API Error Details (Dashboard):', (err as any).details);
        }
        err.statusCode = err.statusCode || 500;
        throw err; // Re-throw the structured ApiError
      } else if ((err as any)?.response?.data?.Fault?.Error) { // More specific check for QBO fault
        console.error('[QB CONTROLLER] QuickBooks API Fault (Dashboard):', (err as any).response.data.Fault.Error);
        const qboError = (err as any).response.data.Fault.Error[0];
        throw new ApiError((err as any).response?.status || 500, `QuickBooks API Error: ${qboError?.Message || 'Unknown error'} (Code: ${qboError?.code || 'N/A'})`);
      } else if ((err as any)?.response) { // Generic Axios error
         console.error('[QB CONTROLLER] Axios Error Data (Dashboard):', (err as any).response.data);
         throw new ApiError( (err as any).response?.status || 500, `API request failed: ${ (err as any).message}`);
      } else {
        // Throw a generic server error for unexpected issues (like parsing errors caught above)
        throw new ApiError(500, `An unexpected error occurred while fetching dashboard data: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Endpoint to handle scenario planning calculations.
   */
   async runScenario(organizationId: string, scenarioParams: any /* Define scenario input type */) {
       try {
           console.log(`[QB CONTROLLER] Starting runScenario for org ${organizationId}`);
           // 1. Fetch BASE data needed for forecasting
           const connection = await prisma.quickbooksConnection.findUnique({ where: { organizationId } });
           if (!connection || !connection.isActive) throw new ApiError(400, "No active QuickBooks connection");
           const realmId = connection.realmId;
            console.log(`[QB CONTROLLER] Scenario planning using Realm ID: ${realmId}`);

           // Fetch minimal required data - adjust date ranges/params as needed
            const now = new Date();
            const endDateMinimal = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            const startDateMinimal = new Date(endDateMinimal);
            startDateMinimal.setMonth(startDateMinimal.getMonth() - 11); // ~12 months history
            startDateMinimal.setDate(1);
            const formatQBDate = (date: Date) => date.toISOString().split("T")[0];

           const plParamsMinimal = {
               start_date: formatQBDate(startDateMinimal),
               end_date: formatQBDate(endDateMinimal),
               accounting_method: "Cash", // Or make this dynamic
               minorversion: "65",
               summarize_column_by: "Month",
           };
           const bsParamsMinimal = { date: formatQBDate(endDateMinimal), accounting_method: "Cash", minorversion: "65" };

           const [chartOfAccounts, plReportMinimal, bsReportMinimal, openInvoicesMinimal, openBillsMinimal] = await Promise.all([
               this.fetchChartOfAccounts(organizationId, realmId), // Need CoA for parsing
               this.fetchReportWithCache(organizationId, realmId, "ProfitAndLoss", plParamsMinimal),
               this.fetchReportWithCache(organizationId, realmId, "BalanceSheet", bsParamsMinimal),
               this.fetchOpenInvoices(organizationId, realmId),
               this.fetchOpenBills(organizationId, realmId)
           ]);
            console.log(`[QB CONTROLLER] Base data fetched for scenario planning, realm ${realmId}.`);

           // Basic parsing - add robust checks
           if (!plReportMinimal || !plReportMinimal.Header || !plReportMinimal.Rows) {
               console.error(`[QB CONTROLLER] Failed to fetch valid minimal P&L report for scenario planning, realm ${realmId}.`);
               throw new ApiError(500, "Could not retrieve base Profit & Loss report required for scenario planning.");
           }
            if (!bsReportMinimal || !bsReportMinimal.Header || !bsReportMinimal.Rows) {
               console.error(`[QB CONTROLLER] Failed to fetch valid minimal BS report for scenario planning, realm ${realmId}.`);
               throw new ApiError(500, "Could not retrieve base Balance Sheet report required for scenario planning.");
           }

            let baseHistoricalPL: ParsedReportData[] | null = null;
            let baseCurrentBS: ParsedBalanceSheet | null = null;
            try {
                baseHistoricalPL = parseMultiMonthProfitAndLoss(plReportMinimal, chartOfAccounts);
                baseCurrentBS = parseBalanceSheet(bsReportMinimal, chartOfAccounts);
            } catch(parseError) {
                console.error(`[QB CONTROLLER] *** ERROR parsing base reports for scenario planning, realm ${realmId}:`, parseError);
                throw new ApiError(500, `Internal error parsing base reports for scenario: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            }
           const baseAging = calculateAging(
               openInvoicesMinimal,
               openBillsMinimal,
               baseCurrentBS?.assets?.accountsReceivable || 0,
               baseCurrentBS?.liabilities?.accountsPayable || 0
           );


           // Check parsed results
           if (!baseHistoricalPL || !Array.isArray(baseHistoricalPL) || !baseCurrentBS || typeof baseCurrentBS !== 'object') {
               console.error(`[QB CONTROLLER] Failed to parse minimal reports correctly for scenario planning, realm ${realmId}. Parser returned invalid data.`);
               throw new ApiError(500, "Could not process base financial data required for scenario planning.");
           }
           // Extract base cash safely
           const baseCash = baseCurrentBS?.assets?.cashAndEquivalents || 0;
           console.log(`[QB CONTROLLER] Base data parsed for scenario planning, realm ${realmId}. Base Cash: ${baseCash}`);


           // 2. Call forecast service with MODIFIED assumptions
           console.log(`[QB CONTROLLER] Generating scenario forecast for realm ${realmId}...`);
           const scenarioForecast = await forecastService.generateCashFlowForecast({
               historicalPL: baseHistoricalPL,
               currentAR: baseAging.ar,
               currentAP: baseAging.ap,
               currentCash: baseCash,
               scenarioModifiers: scenarioParams,
           });
           console.log(`[QB CONTROLLER] Scenario forecast generated for realm ${realmId}.`);

           // 3. Return the scenario forecast results
           return {
               scenarioName: scenarioParams.name || 'Scenario',
               forecast: scenarioForecast,
           };

       } catch (err) {
           console.error(`[QB CONTROLLER] *** ERROR in runScenario for org ${organizationId}:`, err instanceof Error ? err.message : String(err), err);
            if (err instanceof ApiError) {
                err.statusCode = err.statusCode || 500;
                throw err;
            }
             // Check for QBO specific fault structure
            const qboError = (err as any)?.response?.data?.Fault?.Error?.[0];
            if (qboError) {
                 throw new ApiError((err as any).response?.status || 500, `QuickBooks API Error during scenario base data fetch: ${qboError?.Message || 'Unknown error'} (Code: ${qboError?.code || 'N/A'})`);
            }
            throw new ApiError(500, `Error running scenario: ${err instanceof Error ? err.message : String(err)}`);
       }
   }

}

export const quickbooksDashboardController = new QuickbooksDashboardController();

// NOTE: Assumes existence and implementation of:
// - ../../services/cacheService (e.g., using Redis)
// - ../../services/financial/forecastService (complex time-series logic)
// - ../../services/financial/insightsService (complex rule engine/ML)
// - ../../services/financial/benchmarkService (data acquisition + retrieval)
// - ../../services/quickbooks/quickbooksReportParser (houses parsing, calculation helpers)
//   - ChartOfAccountsMap, ParsedReportData, ParsedBalanceSheet types
//   - parseMultiMonthProfitAndLoss, parseBalanceSheet functions (CoA-aware) -> DEBUG parseMultiMonthProfitAndLoss
//   - calculateCoreMetrics, calculateFinancialRatios, calculateTrends, calculateAging, calculateRunway functions (ensure they handle null inputs gracefully where appropriate)
//   - buildRecentActivity, buildTopCustomers, extractTopExpenseCategories (refined helpers, ensure they handle null/empty inputs)