import { format, subMonths } from 'date-fns';
import { prisma } from '../../utils/prisma';
import { encryption } from '../../utils/encryption';
import { quickbooksApiClient } from '../quickbooks/quickbooksApiClient';
import {
  parseMultiMonthProfitAndLoss,
  parseBalanceSheet,
  calculateCoreMetrics,
  calculateFinancialRatios,
  calculateTrends,
  calculateAging,
  parseAgedReceivablesReport,
  ChartOfAccountsMap,
  CoAEntry,
} from '../quickbooks/quickbooksReportParser';
import type { HealthScoreRawData, RecurringExpenseData } from '../../types/healthScore';
import { ApiError } from '../../utils/errors';

class HealthScoreDataService {
  /**
   * Pull all QuickBooks data for a health score prospect, parse it,
   * and return a HealthScoreRawData object ready for scoring.
   */
  async pullData(prospectId: string): Promise<HealthScoreRawData> {
    // ------------------------------------------------------------------
    // 1. Load prospect from DB and decrypt access token
    // ------------------------------------------------------------------
    const prospect = await prisma.healthScoreProspect.findUnique({
      where: { id: prospectId },
    });

    if (!prospect) {
      throw new ApiError(404, `Health score prospect not found: ${prospectId}`);
    }

    if (!prospect.accessToken || !prospect.realmId) {
      throw new ApiError(400, 'Prospect is missing QuickBooks credentials (accessToken or realmId)');
    }

    let accessToken: string;
    try {
      accessToken = encryption.decrypt(prospect.accessToken);
    } catch (err) {
      console.error(`[HealthScoreData] Failed to decrypt access token for prospect ${prospectId}:`, err);
      throw new ApiError(500, 'Failed to decrypt QuickBooks access token');
    }

    const realmId = prospect.realmId;
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const twelveMonthsAgo = format(subMonths(now, 12), 'yyyy-MM-dd');
    const twentyFourMonthsAgo = format(subMonths(now, 24), 'yyyy-MM-dd');
    const sixMonthsAgo = format(subMonths(now, 6), 'yyyy-MM-dd');

    // ------------------------------------------------------------------
    // 2. Fetch Chart of Accounts first (needed by all parsers)
    // ------------------------------------------------------------------
    let coaMap: ChartOfAccountsMap;
    try {
      const coaResponse = await quickbooksApiClient.queryWithToken(
        accessToken,
        realmId,
        'SELECT * FROM Account WHERE Active = true MAXRESULTS 1000'
      );
      coaMap = this.buildChartOfAccountsMap(coaResponse);
      console.log(`[HealthScoreData] Built Chart of Accounts map with ${coaMap.size} entries`);
    } catch (err) {
      console.error('[HealthScoreData] Failed to fetch Chart of Accounts:', err);
      // CoA is critical for parsing; fall back to an empty map which may
      // degrade parse accuracy but still allows the flow to proceed.
      coaMap = new Map();
    }

    // ------------------------------------------------------------------
    // 3. Fetch all reports in parallel using Promise.allSettled
    // ------------------------------------------------------------------
    const [
      plResult,        // Required
      bsResult,        // Required
      arAgingResult,   // Required (graceful fallback if missing)
      apAgingResult,   // Optional
      priorYearPLResult, // Optional
      companyInfoResult, // Optional
      purchasesResult, // Optional
      billsResult,     // Optional
    ] = await Promise.allSettled([
      // 0: P&L - 12 months monthly (Accrual)
      quickbooksApiClient.getReportWithToken(accessToken, realmId, 'ProfitAndLoss', {
        start_date: twelveMonthsAgo,
        end_date: today,
        summarize_column_by: 'Month',
        accounting_method: 'Accrual',
      }),
      // 1: Balance Sheet (Accrual)
      quickbooksApiClient.getReportWithToken(accessToken, realmId, 'BalanceSheet', {
        as_of: today,
        accounting_method: 'Accrual',
      }),
      // 2: AR Aging
      quickbooksApiClient.getReportWithToken(accessToken, realmId, 'AgedReceivables', {
        report_date: today,
      }),
      // 3: AP Aging (optional)
      quickbooksApiClient.getReportWithToken(accessToken, realmId, 'AgedPayables', {
        report_date: today,
      }),
      // 4: Prior Year P&L (optional) - 24 months ago to 12 months ago
      quickbooksApiClient.getReportWithToken(accessToken, realmId, 'ProfitAndLoss', {
        start_date: twentyFourMonthsAgo,
        end_date: twelveMonthsAgo,
        summarize_column_by: 'Month',
        accounting_method: 'Accrual',
      }),
      // 5: Company Info (optional)
      quickbooksApiClient.queryWithToken(
        accessToken,
        realmId,
        'SELECT * FROM CompanyInfo'
      ),
      // 6: Purchases - last 6 months (optional)
      quickbooksApiClient.queryWithToken(
        accessToken,
        realmId,
        `SELECT * FROM Purchase WHERE TxnDate >= '${sixMonthsAgo}' ORDER BY TxnDate DESC MAXRESULTS 500`
      ),
      // 7: Bills - last 6 months (optional)
      quickbooksApiClient.queryWithToken(
        accessToken,
        realmId,
        `SELECT * FROM Bill WHERE TxnDate >= '${sixMonthsAgo}' ORDER BY TxnDate DESC MAXRESULTS 500`
      ),
    ]);

    // ------------------------------------------------------------------
    // 4. Validate required reports
    // ------------------------------------------------------------------
    if (plResult.status === 'rejected') {
      console.error('[HealthScoreData] FATAL: P&L report fetch failed:', plResult.reason);
      throw new ApiError(502, `Failed to fetch Profit & Loss report from QuickBooks: ${plResult.reason?.message || 'Unknown error'}`);
    }

    if (bsResult.status === 'rejected') {
      console.error('[HealthScoreData] FATAL: Balance Sheet fetch failed:', bsResult.reason);
      throw new ApiError(502, `Failed to fetch Balance Sheet from QuickBooks: ${bsResult.reason?.message || 'Unknown error'}`);
    }

    const plReport = plResult.value;
    const bsReport = bsResult.value;

    // ------------------------------------------------------------------
    // 5. Extract optional results (null if failed)
    // ------------------------------------------------------------------
    const arAgingReport = arAgingResult.status === 'fulfilled' ? arAgingResult.value : null;
    const apAgingReport = apAgingResult.status === 'fulfilled' ? apAgingResult.value : null;
    const priorYearPLReport = priorYearPLResult.status === 'fulfilled' ? priorYearPLResult.value : null;
    const companyInfoResponse = companyInfoResult.status === 'fulfilled' ? companyInfoResult.value : null;
    const purchasesResponse = purchasesResult.status === 'fulfilled' ? purchasesResult.value : null;
    const billsResponse = billsResult.status === 'fulfilled' ? billsResult.value : null;

    if (arAgingResult.status === 'rejected') {
      console.warn('[HealthScoreData] AR Aging report fetch failed (non-fatal):', arAgingResult.reason?.message);
    }
    if (apAgingResult.status === 'rejected') {
      console.warn('[HealthScoreData] AP Aging report fetch failed (non-fatal):', apAgingResult.reason?.message);
    }
    if (priorYearPLResult.status === 'rejected') {
      console.warn('[HealthScoreData] Prior Year P&L fetch failed (non-fatal):', priorYearPLResult.reason?.message);
    }
    if (companyInfoResult.status === 'rejected') {
      console.warn('[HealthScoreData] CompanyInfo fetch failed (non-fatal):', companyInfoResult.reason?.message);
    }
    if (purchasesResult.status === 'rejected') {
      console.warn('[HealthScoreData] Purchases fetch failed (non-fatal):', purchasesResult.reason?.message);
    }
    if (billsResult.status === 'rejected') {
      console.warn('[HealthScoreData] Bills fetch failed (non-fatal):', billsResult.reason?.message);
    }

    // ------------------------------------------------------------------
    // 6. Parse reports
    // ------------------------------------------------------------------

    // P&L (required)
    const monthlyPL = parseMultiMonthProfitAndLoss(plReport, coaMap);
    if (monthlyPL.length === 0) {
      throw new ApiError(422, 'Profit & Loss report returned no parseable monthly data. The QuickBooks account may have insufficient history.');
    }

    // Balance Sheet (required)
    const balanceSheet = parseBalanceSheet(bsReport, coaMap);

    // AR Aging (graceful fallback)
    let arDetails = arAgingReport ? parseAgedReceivablesReport(arAgingReport) : null;

    // Prior Year P&L (optional)
    const priorYearPL = priorYearPLReport
      ? parseMultiMonthProfitAndLoss(priorYearPLReport, coaMap)
      : null;

    // ------------------------------------------------------------------
    // 7. Calculate core metrics, ratios, trends, and aging
    // ------------------------------------------------------------------

    // Core metrics need current BS and optionally prev-month / YoY BS.
    // We only have one BS snapshot (today), so pass null for prev/yoy.
    const coreMetrics = calculateCoreMetrics(monthlyPL, balanceSheet, null, null);
    const financialRatios = calculateFinancialRatios(coreMetrics, coreMetrics.currentProfitLoss || 0);
    const trends = calculateTrends(monthlyPL, coreMetrics);

    // Build aging data.
    // For open-item based aging we need invoice/bill lists, but here we
    // are using the QBO AgedReceivables/AgedPayables reports directly.
    // If the report-based parser gave us arDetails, derive bucket totals from it.
    // Otherwise fall back to balance-sheet-only distribution via calculateAging with empty arrays.
    let aging;
    if (arDetails && arDetails.length > 0) {
      // Derive AR aging buckets from parsed customer details
      const arBuckets = {
        '0-30': 0,
        '31-60': 0,
        '61-90': 0,
        '90+': 0,
        total: 0,
      };
      for (const cust of arDetails) {
        arBuckets['0-30'] += cust.current + cust.overdue1_30;
        arBuckets['31-60'] += cust.overdue31_60;
        arBuckets['61-90'] += cust.overdue61_90;
        arBuckets['90+'] += cust.overdue90Plus;
        arBuckets.total += cust.totalOutstanding;
      }

      // For AP aging, try to parse the AP report similarly (simple bucket extraction)
      const apBuckets = this.extractApAgingBuckets(apAgingReport);

      aging = {
        ar: {
          '0-30': Math.round(arBuckets['0-30'] * 100) / 100,
          '31-60': Math.round(arBuckets['31-60'] * 100) / 100,
          '61-90': Math.round(arBuckets['61-90'] * 100) / 100,
          '90+': Math.round(arBuckets['90+'] * 100) / 100,
          total: Math.round(arBuckets.total * 100) / 100,
        },
        ap: apBuckets,
      };
    } else {
      // Fallback: use calculateAging with empty arrays - it will use BS values
      aging = calculateAging(
        [],
        [],
        balanceSheet.assets.accountsReceivable,
        balanceSheet.liabilities.accountsPayable
      );
    }

    // ------------------------------------------------------------------
    // 8. Extract company name from CompanyInfo (optional)
    // ------------------------------------------------------------------
    const companyName: string | null =
      companyInfoResponse?.QueryResponse?.CompanyInfo?.[0]?.CompanyName ?? prospect.companyName ?? null;

    // Update prospect record with company name if we got one from QB
    if (companyName && companyName !== prospect.companyName) {
      try {
        await prisma.healthScoreProspect.update({
          where: { id: prospectId },
          data: { companyName },
        });
        console.log(`[HealthScoreData] Updated prospect companyName to "${companyName}"`);
      } catch (err) {
        console.warn('[HealthScoreData] Failed to update prospect companyName (non-fatal):', err);
      }
    }

    // ------------------------------------------------------------------
    // 9. Detect recurring expenses from Purchases + Bills (optional)
    // ------------------------------------------------------------------
    const purchases = purchasesResponse?.QueryResponse?.Purchase || [];
    const bills = billsResponse?.QueryResponse?.Bill || [];
    const recurringExpenses = this.detectRecurringExpenses(purchases, bills);

    // ------------------------------------------------------------------
    // 10. Assemble and return the HealthScoreRawData
    // ------------------------------------------------------------------
    const rawData: HealthScoreRawData = {
      companyName,
      industry: prospect.industry ?? null,
      monthlyPL,
      balanceSheet,
      chartOfAccounts: coaMap,
      coreMetrics,
      financialRatios,
      trends,
      aging,
      arDetails,
      priorYearPL: priorYearPL && priorYearPL.length > 0 ? priorYearPL : null,
      recurringExpenses,
    };

    console.log(
      `[HealthScoreData] Successfully assembled raw data for prospect ${prospectId}` +
      ` (company: ${companyName || 'unknown'}, ${monthlyPL.length} months P&L)`
    );

    return rawData;
  }

  // ====================================================================
  // Private helpers
  // ====================================================================

  /**
   * Build a ChartOfAccountsMap from the QB Account query response.
   */
  private buildChartOfAccountsMap(accountsResponse: any): ChartOfAccountsMap {
    const coaMap: ChartOfAccountsMap = new Map();
    const accounts = accountsResponse?.QueryResponse?.Account || [];

    accounts.forEach((a: any) => {
      coaMap.set(a.Id, {
        id: a.Id,
        name: a.Name || 'Unknown',
        accountType: a.AccountType || '',
        accountSubType: a.AccountSubType || '',
        classification: a.Classification || '',
      } as CoAEntry);
    });

    return coaMap;
  }

  /**
   * Detect recurring expenses by grouping purchases and bills by vendor.
   *
   * Logic:
   * - Combine all transactions from Purchases and Bills
   * - Group by vendor name
   * - Count transactions and total spend per vendor
   * - Top 3 vendors as percentage of total spend
   * - Vendors with 3+ transactions in 6 months are considered "recurring"
   */
  private detectRecurringExpenses(purchases: any[], bills: any[]): RecurringExpenseData | null {
    if ((!purchases || purchases.length === 0) && (!bills || bills.length === 0)) {
      return null;
    }

    // Build a vendor-level aggregation
    const vendorMap = new Map<string, { count: number; totalSpend: number }>();

    // Process purchases
    (purchases || []).forEach((p: any) => {
      const vendorName = p.EntityRef?.name || p.VendorRef?.name || null;
      if (!vendorName) return;
      const amount = Math.abs(parseFloat(p.TotalAmt) || 0);
      if (amount === 0) return;

      const existing = vendorMap.get(vendorName) || { count: 0, totalSpend: 0 };
      existing.count += 1;
      existing.totalSpend += amount;
      vendorMap.set(vendorName, existing);
    });

    // Process bills
    (bills || []).forEach((b: any) => {
      const vendorName = b.VendorRef?.name || b.EntityRef?.name || null;
      if (!vendorName) return;
      const amount = Math.abs(parseFloat(b.TotalAmt) || 0);
      if (amount === 0) return;

      const existing = vendorMap.get(vendorName) || { count: 0, totalSpend: 0 };
      existing.count += 1;
      existing.totalSpend += amount;
      vendorMap.set(vendorName, existing);
    });

    if (vendorMap.size === 0) {
      return null;
    }

    // Calculate totals
    let grandTotal = 0;
    const vendors: Array<{ vendorName: string; totalSpend: number; count: number }> = [];
    for (const [vendorName, data] of vendorMap) {
      grandTotal += data.totalSpend;
      vendors.push({ vendorName, totalSpend: data.totalSpend, count: data.count });
    }

    if (grandTotal === 0) {
      return null;
    }

    // Sort by total spend descending
    vendors.sort((a, b) => b.totalSpend - a.totalSpend);

    // Top 3 vendors
    const top3 = vendors.slice(0, 3);
    const top3TotalSpend = top3.reduce((sum, v) => sum + v.totalSpend, 0);
    const vendorConcentrationTop3Pct = Math.round((top3TotalSpend / grandTotal) * 10000) / 100; // e.g. 65.43

    // Determine frequency for each top vendor
    const topVendors = top3.map((v) => {
      let frequency: string;
      if (v.count >= 6) {
        frequency = 'monthly'; // ~1 per month over 6 months
      } else if (v.count >= 12) {
        frequency = 'weekly'; // very frequent
      } else if (v.count >= 3) {
        frequency = 'monthly'; // roughly recurring
      } else {
        frequency = 'irregular';
      }

      return {
        vendorName: v.vendorName,
        totalSpend: Math.round(v.totalSpend * 100) / 100,
        percentOfTotal: Math.round((v.totalSpend / grandTotal) * 10000) / 100,
        frequency,
      };
    });

    // Estimate total recurring monthly: sum spend of vendors with 3+ transactions,
    // divided by 6 (months of data)
    const recurringVendorSpend = vendors
      .filter((v) => v.count >= 3)
      .reduce((sum, v) => sum + v.totalSpend, 0);
    const totalRecurringMonthly = Math.round((recurringVendorSpend / 6) * 100) / 100;

    return {
      totalRecurringMonthly,
      topVendors,
      vendorConcentrationTop3Pct,
    };
  }

  /**
   * Extract simple AP aging buckets from the AgedPayables report.
   * Falls back to zeros if report is unavailable or unparseable.
   */
  private extractApAgingBuckets(
    apReport: any | null
  ): { '0-30': number; '31-60': number; '61-90': number; '90+': number; total: number } {
    const emptyBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };

    if (!apReport?.Rows?.Row) {
      return emptyBuckets;
    }

    // The AgedPayables report has a similar structure to AgedReceivables.
    // Look for the grand total row (Summary of the top-level section or last row).
    const columns = apReport.Columns?.Column || [];
    let currentIdx = -1;
    let bucket1_30Idx = -1;
    let bucket31_60Idx = -1;
    let bucket61_90Idx = -1;
    let bucket90PlusIdx = -1;
    let totalIdx = -1;

    columns.forEach((col: any, idx: number) => {
      const title = (col.ColTitle || '').toLowerCase().trim();
      if (title === 'current' || title === 'not due') {
        currentIdx = idx;
      } else if (title === '1 - 30' || title === '1-30') {
        bucket1_30Idx = idx;
      } else if (title === '31 - 60' || title === '31-60') {
        bucket31_60Idx = idx;
      } else if (title === '61 - 90' || title === '61-90') {
        bucket61_90Idx = idx;
      } else if (title.includes('91') || title.includes('90+') || title.includes('over 90')) {
        bucket90PlusIdx = idx;
      } else if (title === 'total' || title === 'amount') {
        totalIdx = idx;
      }
    });

    // Walk rows to find grand total
    const extractTotalFromRows = (rows: any[]): typeof emptyBuckets | null => {
      for (const row of rows) {
        // Check for Summary (section total) at top-level
        const colData = row.Summary?.ColData;
        if (colData) {
          const label = (colData[0]?.value || '').toLowerCase().trim();
          if (label === 'total' || label.startsWith('total')) {
            const safeFloat = (idx: number) => {
              if (idx < 0 || idx >= colData.length) return 0;
              const val = parseFloat((colData[idx]?.value || '0').replace(/[,]/g, ''));
              return isNaN(val) ? 0 : val;
            };

            return {
              '0-30': Math.round((safeFloat(currentIdx) + safeFloat(bucket1_30Idx)) * 100) / 100,
              '31-60': Math.round(safeFloat(bucket31_60Idx) * 100) / 100,
              '61-90': Math.round(safeFloat(bucket61_90Idx) * 100) / 100,
              '90+': Math.round(safeFloat(bucket90PlusIdx) * 100) / 100,
              total: Math.round(safeFloat(totalIdx) * 100) / 100,
            };
          }
        }
        // Recurse into sections
        if (row.Rows?.Row) {
          const nested = extractTotalFromRows(row.Rows.Row);
          if (nested) return nested;
        }
      }
      return null;
    };

    return extractTotalFromRows(apReport.Rows.Row) || emptyBuckets;
  }
}

export const healthScoreDataService = new HealthScoreDataService();
