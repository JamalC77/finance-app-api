import { parse, differenceInDays, startOfMonth, endOfMonth, isValid, parseISO, differenceInCalendarMonths, format } from 'date-fns'; // Added format

// --- TYPES ---

export interface CoAEntry {
    id: string;
    name: string;
    accountType: string; // e.g., 'Bank', 'Accounts Receivable', 'Income', 'Expense', 'Cost of Goods Sold'
    accountSubType?: string; // e.g., 'Checking', 'Savings', 'SalesOfProductIncome'
    classification?: string; // e.g., 'Asset', 'Liability', 'Revenue', 'Expense'
}

export type ChartOfAccountsMap = Map<string, CoAEntry>; // Map Account ID to CoAEntry

export interface ParsedReportRow {
    id?: string; // Account ID if available directly in report row
    name: string;
    value: number;
    rowType?: 'Account' | 'SectionTotal' | 'Header'; // Add type if identifiable
    subRows?: ParsedReportRow[];
}

// P&L Data for a single period (month) - Modified startDate/endDate
export interface ParsedReportData {
    month: string; // e.g., "Jan 2024"
    startDate: string | null; // ISO Format YYYY-MM-DD or null
    endDate: string | null;   // ISO Format YYYY-MM-DD or null
    income: number;
    cogs: number;
    grossProfit: number;
    expenses: number; // Operating expenses (excluding COGS)
    operatingIncome: number;
    netIncome: number;
}

// Parsed Balance Sheet for a specific date
export interface ParsedBalanceSheet {
    reportDate: string; // ISO Format YYYY-MM-DD
    assets: {
        cashAndEquivalents: number;
        accountsReceivable: number;
        otherCurrentAssets: number;
        totalCurrentAssets: number;
        totalLongTermAssets: number; // Non-current assets
        totalAssets: number;
    };
    liabilities: {
        accountsPayable: number;
        creditCards: number;
        otherCurrentLiabilities: number;
        totalCurrentLiabilities: number;
        totalLongTermLiabilities: number; // Non-current liabilities
        totalLiabilities: number;
    };
    equity: {
        // Add specific equity components if needed (Retained Earnings, etc.)
        totalEquity: number;
    };
}

// Types returned by calculation functions (match controller usage)
export interface CoreMetrics {
    currentIncome: number;
    currentExpenses: number;
    currentProfitLoss: number;
    currentCOGS: number;
    cashBalance: number;
    prevMonthCashBalance: number;
    yoyCashBalance?: number;
    totalAR: number;
    totalAP: number;
    totalCOGS: number;
    totalOperatingExpenses: number;
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
export interface FinancialRatios {
    netProfitMargin: number | null;
    grossProfitMargin: number | null;
    operatingProfitMargin: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    workingCapital: number;
    debtToEquity: number | null;
}
export interface TrendData {
    monthlyPLData: ParsedReportData[]; yoyIncomeChange?: number; yoyProfitChange?: number;
    avgMonthlyBurn: number; // Negative if profitable avg
}
export interface AgingData {
    ar: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
    ap: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
}

// Recent Activity Type
export interface RecentActivityItem {
    id: string;
    type: string; // e.g., "INVOICE_PAID", "BILL_CREATED" etc.
    description: string;
    date: Date; // Ensure conversion from string
    amount: number;
    customerOrVendorName?: string;
}
// Customer Type
export interface CustomerItem {
    id: string;
    name: string;
    revenue: number; // Or other relevant metric for the period
}
// Expense Category Type
export interface CategoryItem {
    category: string;
    amount: number;
}


// --- Helper Functions ---

/** Safely parse float from input, returning 0 if invalid/null/undefined */
const safeParseFloat = (value: any): number => {
    // --- FIX: Handle numbers directly ---
    if (typeof value === 'number') {
        return isNaN(value) ? 0 : value; // Handle potential NaN numbers
    }
    if (typeof value === 'string') {
        if (value === '') return 0; // Handle empty string
        // Remove commas, handle parentheses for negatives if QBO uses them
        const cleanedValue = value.replace(/[,]/g, '').replace(/[()]/g, '');
        const num = parseFloat(cleanedValue);
        // Check if original value might have been negative (e.g., "(1,234.56)")
        if (!isNaN(num) && value.includes('(') && value.includes(')')) {
            return -Math.abs(num);
        }
        return isNaN(num) ? 0 : num;
    }
    // Handle null, undefined, boolean, object, etc.
    return 0;
};

/** Attempts to parse various date string formats from QBO */
const parseQBDate = (dateString: string | undefined | null): Date | null => {
    if (!dateString) return null;
    try {
        // Try ISO format first (YYYY-MM-DD) - Most common in API
        let date = parseISO(dateString);
        if (isValid(date)) return date;

        // Try other common formats if needed (e.g., MM/DD/YYYY - less likely in API?)
        // date = parse(dateString, 'MM/dd/yyyy', new Date());
        // if (isValid(date)) return date;

        // Only warn if it's not explicitly 'N/A' which we used before (now using null)
        if (dateString !== 'N/A') {
            console.warn(`[Parser] Could not parse date string using expected formats: ${dateString}`);
        }
        return null;
    } catch (e) {
        console.error(`[Parser] Error parsing date string: ${dateString}`, e);
        return null;
    }
};

/** Formats a Date object into YYYY-MM-DD */
const formatQBDate = (date: Date): string => {
    return format(date, 'yyyy-MM-dd');
};


/**
 * Find report rows matching CoA types/subtypes or names recursively.
 * Extracts name, value, and attempts to identify Account ID.
 * @param rows Raw rows from QBO report (e.g., report.Rows.Row)
 * @param coaMap Chart of Accounts map
 * @param valueColIndex Index of the column containing the numeric value (usually 1)
 * @param types Array of AccountType strings to match
 * @param subTypes Array of AccountSubType strings to match (optional)
 * @param nameKeywords Array of lowercase keywords to match in row names (fallback)
 * @param exactName Optional exact name to match
 * @returns Array of ParsedReportRow matching the criteria.
 */
const findRowsByCriteria = (
    rows: any[] | undefined,
    coaMap: ChartOfAccountsMap,
    valueColIndex: number,
    types: string[],
    subTypes: string[] = [],
    nameKeywords: string[] = [],
    exactName: string = ''
): ParsedReportRow[] => {
    if (!rows) return [];
    const results: ParsedReportRow[] = [];

    for (const row of rows) {
        const primaryColData = row.Header?.ColData || row.ColData || row.Summary?.ColData;
        const valueColData = row.ColData || row.Summary?.ColData;

        if (!primaryColData || primaryColData.length === 0) continue;
        // Check if valueColData exists before accessing length
        if (!valueColData || valueColData.length <= valueColIndex) continue;

        const rowName = primaryColData[0]?.value || '';
        const rowId = primaryColData[0]?.id;
        const rowValue = safeParseFloat(valueColData[valueColIndex]?.value); // Uses updated safeParseFloat

        let match = false;
        const coaEntry = rowId ? coaMap.get(rowId) : undefined;

        if (exactName && rowName.trim().toLowerCase() === exactName.toLowerCase()) {
            match = true;
        }
        else if (coaEntry && types.length > 0) {
            if (types.includes(coaEntry.accountType)) {
                match = true;
                if (subTypes.length > 0 && !subTypes.includes(coaEntry.accountSubType || '')) {
                    match = false;
                }
            }
        }
        else if (!exactName && !coaEntry && nameKeywords.length > 0) {
            const lowerRowName = rowName.toLowerCase().trim();
            if (nameKeywords.some(keyword => lowerRowName.includes(keyword))) {
                const isSummaryOrHeader = !!(row.Header || row.Summary);
                if (!isSummaryOrHeader || nameKeywords.some(k => lowerRowName === k || lowerRowName === `total ${k}`)) {
                   match = true;
                }
            }
        }

        if (match) {
            const parsedRow: ParsedReportRow = {
                id: rowId,
                name: rowName.trim(),
                value: rowValue,
                rowType: row.Header ? 'Header' : row.Summary ? 'SectionTotal' : 'Account',
            };
            if (row.Rows?.Row) {
                parsedRow.subRows = findRowsByCriteria(row.Rows.Row, coaMap, valueColIndex, types, subTypes, nameKeywords, exactName);
            }
             results.push(parsedRow);

        } else if (row.Rows?.Row) {
             results.push(...findRowsByCriteria(row.Rows.Row, coaMap, valueColIndex, types, subTypes, nameKeywords, exactName));
        }
    }
    return results;
};


/** Sums the 'value' property of ParsedReportRow array */
const sumParsedRows = (rows: ParsedReportRow[]): number => {
    let total = 0;
     rows.forEach(row => {
         total += row.value || 0;
     });
     return total;
};

// --- Parsing Functions ---

/**
 * Parses a multi-month Profit and Loss report from QuickBooks.
 * Iterates through months and rows directly for robustness.
 */
export const parseMultiMonthProfitAndLoss = (
    report: any,
    coaMap: ChartOfAccountsMap // Kept for potential future detailed parsing
): ParsedReportData[] => {
    if (!report?.Columns?.Column || !report?.Rows?.Row || report.Rows.Row.length === 0) {
        console.warn("[Parser] P&L Report is missing Columns, Rows, or Rows are empty.");
        return [];
    }
    const columnInfo = report.Columns.Column;
    const reportRows = report.Rows.Row;

    // --- Identify month columns ---
    const monthColumns: { index: number; label: string; startDate?: string; endDate?: string }[] = [];
    const isSummarizedByMonth = report.Header?.SummarizeColumnsBy === 'Month';

    if (isSummarizedByMonth && columnInfo.length > 1) {
        console.log(`[Parser] Report summarized by Month. Identifying columns...`);
        for (let i = 1; i < columnInfo.length; i++) {
            const col = columnInfo[i];
            const colType = col.ColType || '';
            const colTitle = col.ColTitle || '';
            // --- FIX: Explicitly skip 'total' column title AND type ---
            if (colType.toLowerCase() !== 'total' && colTitle.toLowerCase() !== 'total' && colTitle) {
                const metaDataArray = col.MetaData || [];
                const startDate = metaDataArray.find((m: any) => m.Name === 'StartPeriod')?.Value;
                const endDate = metaDataArray.find((m: any) => m.Name === 'EndPeriod')?.Value;
                monthColumns.push({ index: i, label: colTitle, startDate: startDate, endDate: endDate });
            } else {
                 console.log(`[Parser] Skipping P&L column index ${i} ('${colTitle}') - Type: '${colType}'. It might be a 'Total' column or missing a title.`);
            }
        }
    } else {
         console.warn(`[Parser] P&L report header does not specify SummarizeColumnsBy: "Month" or has insufficient columns. Cannot reliably identify month columns.`);
         return [];
    }

    if (monthColumns.length === 0) {
        console.error("[Parser] CRITICAL: No month columns were identified after processing column info. Check report structure and column parsing logic.");
        return [];
    }
    console.log(`[Parser] Identified ${monthColumns.length} potential month columns in P&L.`);

    // --- Extract Data for Each Month ---
    const results: ParsedReportData[] = [];
    for (const monthCol of monthColumns) {
        const colIdx = monthCol.index;
        let monthlyIncome = 0, monthlyCogs = 0, monthlyTotalExpenses = 0, monthlyNetIncome = 0;
        let foundIncome = false, foundCogs = false, foundTotalExpenses = false, foundNetIncome = false;

        for (const row of reportRows) {
            const rowDataSource = row.Summary?.ColData || row.ColData || row.Header?.ColData;
            // Check rowDataSource exists and has enough columns BEFORE accessing index
            if (!rowDataSource || rowDataSource.length <= colIdx) continue;
            const rowTitle = (rowDataSource[0]?.value || '').trim().toLowerCase();

            if (!foundIncome && (rowTitle === 'total income' || rowTitle === 'total revenue')) {
                monthlyIncome = safeParseFloat(rowDataSource[colIdx]?.value); // Uses updated safeParseFloat
                foundIncome = true;
            } else if (!foundCogs && (rowTitle === 'total cost of goods sold' || rowTitle === 'total cogs')) {
                monthlyCogs = safeParseFloat(rowDataSource[colIdx]?.value); // Uses updated safeParseFloat
                foundCogs = true;
            } else if (!foundTotalExpenses && rowTitle === 'total expenses') {
                monthlyTotalExpenses = safeParseFloat(rowDataSource[colIdx]?.value); // Uses updated safeParseFloat
                foundTotalExpenses = true;
            } else if (!foundNetIncome && (rowTitle === 'net income' || rowTitle === 'net earnings' )) {
                 monthlyNetIncome = safeParseFloat(rowDataSource[colIdx]?.value); // Uses updated safeParseFloat
                 foundNetIncome = true;
            } else if (!foundNetIncome && rowTitle === 'net operating income') {
                monthlyNetIncome = safeParseFloat(rowDataSource[colIdx]?.value); // Uses updated safeParseFloat
                foundNetIncome = true;
            }
             if (foundIncome && foundCogs && foundTotalExpenses && foundNetIncome) break;
        }

        monthlyCogs = Math.abs(monthlyCogs);
        monthlyTotalExpenses = Math.abs(monthlyTotalExpenses);
        const monthlyOperatingExpenses = foundTotalExpenses ? Math.max(0, monthlyTotalExpenses - monthlyCogs) : 0;
        const monthlyGrossProfit = monthlyIncome - monthlyCogs;
        const monthlyOperatingIncome = monthlyGrossProfit - monthlyOperatingExpenses;

        if (!foundNetIncome) monthlyNetIncome = monthlyOperatingIncome;

        if (!foundIncome && !foundCogs && !foundTotalExpenses && !foundNetIncome && monthlyIncome === 0 && monthlyNetIncome === 0) {
             console.warn(`[Parser] Month ${monthCol.label} (Index ${colIdx}): Failed to find ANY key P&L figures. Skipping this month.`);
             continue;
        }

        let derivedStartDate: string | null = monthCol.startDate || null;
        let derivedEndDate: string | null = monthCol.endDate || null;

        // --- FIX: Derive dates only if BOTH are null, store null if derivation fails ---
        if (derivedStartDate === null || derivedEndDate === null) {
             try {
                 const parsedMonth = parse(monthCol.label, 'MMM yyyy', new Date());
                 if(isValid(parsedMonth)){
                     derivedStartDate = formatQBDate(startOfMonth(parsedMonth));
                     derivedEndDate = formatQBDate(endOfMonth(parsedMonth));
                 } else {
                     // Keep derivedStartDate/EndDate as null if parsing failed
                     derivedStartDate = null;
                     derivedEndDate = null;
                     // Log only if label wasn't something expected like 'Total'
                     if (monthCol.label.toLowerCase() !== 'total') {
                         console.warn(`[Parser] Could not derive dates from month label: ${monthCol.label}`);
                     }
                 }
             } catch (e) {
                 console.warn(`[Parser] Error deriving dates from month label ${monthCol.label}:`, e);
                 derivedStartDate = null; // Ensure null on error
                 derivedEndDate = null;
              }
        }

        results.push({
            month: monthCol.label,
            startDate: derivedStartDate, // Can be string or null
            endDate: derivedEndDate,     // Can be string or null
            income: monthlyIncome,
            cogs: monthlyCogs,
            grossProfit: monthlyGrossProfit,
            expenses: monthlyOperatingExpenses,
            operatingIncome: monthlyOperatingIncome,
            netIncome: monthlyNetIncome,
        });
    }

    if (results.length === 0 && reportRows.length > 0) {
         console.error("[Parser] P&L Parsing finished but generated NO monthly results...");
    } else {
         console.log(`[Parser] P&L Parsing successfully generated data for ${results.length} months.`);
    }
    return results;
};


/**
 * Parses a Balance Sheet report from QuickBooks.
 */
export const parseBalanceSheet = (
    report: any,
    coaMap: ChartOfAccountsMap
): ParsedBalanceSheet => {
    // (Keep this function as it was)
     const reportDate = report?.Header?.EndPeriod || report?.Header?.Date || new Date().toISOString().split('T')[0];
    const defaultValue: ParsedBalanceSheet = { reportDate: reportDate, assets: { cashAndEquivalents: 0, accountsReceivable: 0, otherCurrentAssets: 0, totalCurrentAssets: 0, totalLongTermAssets: 0, totalAssets: 0 }, liabilities: { accountsPayable: 0, creditCards: 0, otherCurrentLiabilities: 0, totalCurrentLiabilities: 0, totalLongTermLiabilities: 0, totalLiabilities: 0 }, equity: { totalEquity: 0 }, };
    if (!report?.Rows?.Row) { console.warn(`[Parser] Balance Sheet for ${reportDate} has no Rows.`); return defaultValue; }
    const reportRows = report.Rows.Row; const valueColIndex = 1;
    let assetsSection: any = null, liabilitiesSection: any = null, equitySection: any = null, liabEquitySection: any = null;
    for (const row of reportRows) { const title = (row.Header?.ColData?.[0]?.value || row.Summary?.ColData?.[0]?.value || '').trim().toLowerCase(); const group = row.group?.toLowerCase(); if (title === 'assets' || group === 'assets') assetsSection = row; else if (title === 'liabilities and equity' || group === 'liabilitiesandequity') liabEquitySection = row; else if (title === 'liabilities' || group === 'liabilities') liabilitiesSection = row; else if (title === 'equity' || group === 'equity') equitySection = row; }
    if (liabEquitySection && (!liabilitiesSection || !equitySection)) { const subRows = liabEquitySection.Rows?.Row || []; for (const subRow of subRows) { const subTitle = (subRow.Header?.ColData?.[0]?.value || subRow.Summary?.ColData?.[0]?.value || '').trim().toLowerCase(); const subGroup = subRow.group?.toLowerCase(); if (!liabilitiesSection && (subTitle === 'liabilities' || subGroup === 'liabilities')) liabilitiesSection = subRow; if (!equitySection && (subTitle === 'equity' || subGroup === 'equity')) equitySection = subRow; } }
     if (!assetsSection || !liabilitiesSection || !equitySection) { console.warn(`[Parser] Could not find required sections (Assets, Liabilities, Equity) in Balance Sheet for ${reportDate}. Attempting totals.`); defaultValue.assets.totalAssets = sumParsedRows(findRowsByCriteria(reportRows, coaMap, valueColIndex, [], [], [], 'Total Assets')); defaultValue.liabilities.totalLiabilities = sumParsedRows(findRowsByCriteria(reportRows, coaMap, valueColIndex, [], [], [], 'Total Liabilities')); defaultValue.equity.totalEquity = sumParsedRows(findRowsByCriteria(reportRows, coaMap, valueColIndex, [], [], [], 'Total Equity')); console.warn(`[Parser] Fallback Totals: A=${defaultValue.assets.totalAssets}, L=${defaultValue.liabilities.totalLiabilities}, E=${defaultValue.equity.totalEquity}`); return defaultValue; }
    const assetRows = assetsSection.Rows?.Row; const liabRows = liabilitiesSection.Rows?.Row; const equityRows = equitySection.Rows?.Row;
    const findTotalValue = (sectionRows: any[] | undefined, exactName: string): number => { if (!sectionRows) return 0; const row = sectionRows.find((r: any) => (r.Summary?.ColData?.[0]?.value || r.Header?.ColData?.[0]?.value || '').trim().toLowerCase() === exactName.toLowerCase()); return safeParseFloat(row?.Summary?.ColData?.[valueColIndex]?.value); };
    const cashRows = findRowsByCriteria(assetRows, coaMap, valueColIndex, ['Bank'], ['Checking', 'Savings', 'CashOnHand', 'MoneyMarket'], ['cash', 'bank']); const arRows = findRowsByCriteria(assetRows, coaMap, valueColIndex, ['Accounts Receivable'], [], ['accounts receivable']); const otherCurrentAssetRows = findRowsByCriteria(assetRows, coaMap, valueColIndex, ['Other Current Asset', 'Inventory'], [], ['current asset'], '');
    defaultValue.assets.totalCurrentAssets = findTotalValue(assetRows, 'Total Current Assets'); defaultValue.assets.totalAssets = findTotalValue(assetRows, 'Total Assets'); defaultValue.assets.cashAndEquivalents = sumParsedRows(cashRows); defaultValue.assets.accountsReceivable = sumParsedRows(arRows); if (defaultValue.assets.totalCurrentAssets > 0) { defaultValue.assets.otherCurrentAssets = defaultValue.assets.totalCurrentAssets - defaultValue.assets.cashAndEquivalents - defaultValue.assets.accountsReceivable; } else { defaultValue.assets.otherCurrentAssets = sumParsedRows(otherCurrentAssetRows); defaultValue.assets.totalCurrentAssets = defaultValue.assets.cashAndEquivalents + defaultValue.assets.accountsReceivable + defaultValue.assets.otherCurrentAssets; } defaultValue.assets.totalLongTermAssets = defaultValue.assets.totalAssets - defaultValue.assets.totalCurrentAssets;
    const apRows = findRowsByCriteria(liabRows, coaMap, valueColIndex, ['Accounts Payable'], [], ['accounts payable']); const ccRows = findRowsByCriteria(liabRows, coaMap, valueColIndex, ['Credit Card'], [], ['credit card']); const otherCurrentLiabRows = findRowsByCriteria(liabRows, coaMap, valueColIndex, ['Other Current Liability'], [], ['current liability'], '');
    defaultValue.liabilities.totalCurrentLiabilities = findTotalValue(liabRows, 'Total Current Liabilities'); defaultValue.liabilities.totalLiabilities = findTotalValue(liabRows, 'Total Liabilities'); defaultValue.liabilities.accountsPayable = sumParsedRows(apRows); defaultValue.liabilities.creditCards = sumParsedRows(ccRows); if (defaultValue.liabilities.totalCurrentLiabilities > 0) { defaultValue.liabilities.otherCurrentLiabilities = defaultValue.liabilities.totalCurrentLiabilities - defaultValue.liabilities.accountsPayable - defaultValue.liabilities.creditCards; } else { defaultValue.liabilities.otherCurrentLiabilities = sumParsedRows(otherCurrentLiabRows); defaultValue.liabilities.totalCurrentLiabilities = defaultValue.liabilities.accountsPayable + defaultValue.liabilities.creditCards + defaultValue.liabilities.otherCurrentLiabilities; } defaultValue.liabilities.totalLongTermLiabilities = defaultValue.liabilities.totalLiabilities - defaultValue.liabilities.totalCurrentLiabilities;
    defaultValue.equity.totalEquity = findTotalValue(equityRows, 'Total Equity'); if (defaultValue.equity.totalEquity === 0 && defaultValue.assets.totalAssets !== 0) { defaultValue.equity.totalEquity = defaultValue.assets.totalAssets - defaultValue.liabilities.totalLiabilities; }
    const balanceCheck = defaultValue.assets.totalAssets - (defaultValue.liabilities.totalLiabilities + defaultValue.equity.totalEquity); const tolerance = 1.0; if (Math.abs(balanceCheck) > tolerance) { console.warn(`[Parser] Balance Sheet for ${reportDate} might be unbalanced. A=${defaultValue.assets.totalAssets.toFixed(2)}, L=${defaultValue.liabilities.totalLiabilities.toFixed(2)}, E=${defaultValue.equity.totalEquity.toFixed(2)}. Diff: ${balanceCheck.toFixed(2)}`); }
    return defaultValue;
};


// --- Calculation Functions ---

/** Calculates core metrics by comparing current period to previous/YoY */
export const calculateCoreMetrics = (
    plData: ParsedReportData[],
    currentBS: ParsedBalanceSheet,
    prevMonthBS: ParsedBalanceSheet | null,
    yoyBS: ParsedBalanceSheet | null
): CoreMetrics => {
    if (!plData || plData.length === 0) {
        console.error("[Metrics] Cannot calculate core metrics: Profit and Loss data is empty.");
        return { /* Return zeroed structure */ } as CoreMetrics;
    }
    const currentPL = plData[plData.length - 1];
    const prevMonthPL = plData.length > 1 ? plData[plData.length - 2] : null;
    const currentMonthDate = parseQBDate(currentPL.startDate); // Handles null startDate
    const yoyPL = currentMonthDate && isValid(currentMonthDate) ? plData.find(p => { const pDate = parseQBDate(p.startDate); return pDate && isValid(pDate) && differenceInCalendarMonths(currentMonthDate, pDate) === 12; }) : null;
    const metrics: Partial<CoreMetrics> = {};
    metrics.currentIncome = currentPL?.income ?? 0; metrics.currentExpenses = currentPL?.expenses ?? 0; metrics.currentProfitLoss = currentPL?.netIncome ?? 0; metrics.currentCOGS = currentPL?.cogs ?? 0; metrics.totalOperatingExpenses = currentPL?.expenses ?? 0; metrics.totalCOGS = currentPL?.cogs ?? 0;
    metrics.cashBalance = currentBS.assets.cashAndEquivalents; metrics.totalAR = currentBS.assets.accountsReceivable; metrics.totalAP = currentBS.liabilities.accountsPayable; metrics.totalCurrentAssets = currentBS.assets.totalCurrentAssets; metrics.totalCurrentLiabilities = currentBS.liabilities.totalCurrentLiabilities; metrics.totalAssets = currentBS.assets.totalAssets; metrics.totalLiabilities = currentBS.liabilities.totalLiabilities; metrics.totalEquity = currentBS.equity.totalEquity;
    metrics.prevMonthCashBalance = prevMonthBS?.assets.cashAndEquivalents ?? 0; metrics.yoyCashBalance = yoyBS?.assets.cashAndEquivalents;
    const calcChange = (oldVal: number | undefined | null, newVal: number | undefined | null): number => { const oldN = oldVal ?? 0; const newN = newVal ?? 0; if (oldN === 0) { if (newN > 0) return 100; if (newN < 0) return -100; return 0; } return Math.round(((newN - oldN) / Math.abs(oldN)) * 100); };
    metrics.cashChangePercentage = calcChange(metrics.prevMonthCashBalance, metrics.cashBalance); metrics.incomeChangePercentage = calcChange(prevMonthPL?.income, metrics.currentIncome); metrics.expensesChangePercentage = calcChange(prevMonthPL?.expenses, metrics.currentExpenses); metrics.profitLossChangePercentage = calcChange(prevMonthPL?.netIncome, metrics.currentProfitLoss);
    const daysInCurrentMonth = currentMonthDate && isValid(currentMonthDate) ? differenceInDays(endOfMonth(currentMonthDate), startOfMonth(currentMonthDate)) + 1 : 30;
    const avgDailySales = (metrics.currentIncome ?? 0) / daysInCurrentMonth; metrics.dso = (avgDailySales > 0) ? Math.round(metrics.totalAR / avgDailySales) : 0;
    const avgDailyCOGS = (metrics.currentCOGS ?? 0) / daysInCurrentMonth; metrics.dpo = (avgDailyCOGS > 0) ? Math.round(metrics.totalAP / avgDailyCOGS) : 0;
    if (metrics.dpo === 0 && metrics.totalAP > 0 && (metrics.currentExpenses ?? 0) > 0) { const avgDailyExpenses = (metrics.currentExpenses ?? 0) / daysInCurrentMonth; metrics.dpo = (avgDailyExpenses > 0) ? Math.round(metrics.totalAP / avgDailyExpenses) : 0; }
    metrics.dso = Math.max(0, metrics.dso); metrics.dpo = Math.max(0, metrics.dpo);
    return metrics as CoreMetrics;
};

/** Calculates financial ratios */
export const calculateFinancialRatios = (
    metrics: CoreMetrics,
    currentPeriodNetIncome: number // Can likely be removed, use metrics.currentProfitLoss
): FinancialRatios => {
    const ratios: Partial<FinancialRatios> = {};
    const currentIncome = metrics.currentIncome || 0; const currentNetIncome = metrics.currentProfitLoss || 0; const currentCOGS = metrics.currentCOGS || 0; const currentOpEx = metrics.totalOperatingExpenses || 0;
    ratios.netProfitMargin = (currentIncome !== 0) ? (currentNetIncome / currentIncome) * 100 : null; const currentGrossProfit = currentIncome - currentCOGS; ratios.grossProfitMargin = (currentIncome !== 0) ? (currentGrossProfit / currentIncome) * 100 : null; const currentOperatingIncome = currentGrossProfit - currentOpEx; ratios.operatingProfitMargin = (currentIncome !== 0) ? (currentOperatingIncome / currentIncome) * 100 : null;
    const totalCurrentLiabilities = metrics.totalCurrentLiabilities || 0; ratios.currentRatio = (totalCurrentLiabilities > 0) ? metrics.totalCurrentAssets / totalCurrentLiabilities : null; const quickAssets = (metrics.cashBalance || 0) + (metrics.totalAR || 0); ratios.quickRatio = (totalCurrentLiabilities > 0) ? quickAssets / totalCurrentLiabilities : null; ratios.workingCapital = metrics.totalCurrentAssets - totalCurrentLiabilities;
    const totalEquity = metrics.totalEquity || 0; ratios.debtToEquity = (totalEquity !== 0) ? metrics.totalLiabilities / totalEquity : null;
    Object.keys(ratios).forEach(key => { const k = key as keyof FinancialRatios; const value = ratios[k]; if (typeof value === 'number' && !isFinite(value)) { ratios[k] = null as any; } });
    return ratios as FinancialRatios;
};


/** Calculates trends (YoY changes, avg burn rate) */
export const calculateTrends = (
    plData: ParsedReportData[],
    metrics: CoreMetrics
): TrendData => {
    const trends: Partial<TrendData> = {}; trends.monthlyPLData = plData || [];
    if (!plData || plData.length === 0) { console.warn("[Trends] Cannot calculate trends: P&L data is empty."); return { monthlyPLData: [], avgMonthlyBurn: 0 }; }
    const currentPL = plData[plData.length - 1]; const currentMonthDate = parseQBDate(currentPL?.startDate); // Handles null
    const yoyPL = currentMonthDate && isValid(currentMonthDate) ? plData.find(p => { const pDate = parseQBDate(p.startDate); return pDate && isValid(pDate) && differenceInCalendarMonths(currentMonthDate, pDate) === 12; }) : null;
    const calcChange = (oldVal: number | undefined | null, newVal: number | undefined | null): number | undefined => { const oldN = oldVal ?? 0; const newN = newVal ?? 0; if (oldN === 0) return (newN === 0) ? 0 : undefined; return Math.round(((newN - oldN) / Math.abs(oldN)) * 100); };
    trends.yoyIncomeChange = calcChange(yoyPL?.income, currentPL?.income); trends.yoyProfitChange = calcChange(yoyPL?.netIncome, currentPL?.netIncome);
    const burnLookback = Math.min(6, plData.length); if (burnLookback > 0) { const recentNetIncomes = plData.slice(-burnLookback).map(p => p.netIncome || 0); const avgNetIncome = recentNetIncomes.reduce((sum, ni) => sum + ni, 0) / burnLookback; trends.avgMonthlyBurn = -avgNetIncome; } else { trends.avgMonthlyBurn = 0; }
    return trends as TrendData;
};

/** Calculates AR and AP aging buckets */
export const calculateAging = (
    openInvoices: any[],
    openBills: any[]
): AgingData => {
    // (Uses updated safeParseFloat)
    const today = new Date();
    const aging: AgingData = { ar: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 }, ap: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 }, };
    openInvoices.forEach(inv => { const balance = safeParseFloat(inv.Balance); if (balance <= 0) return; const dueDate = parseQBDate(inv.DueDate); const txnDate = parseQBDate(inv.TxnDate); const refDate = dueDate || txnDate; aging.ar.total += balance; if (refDate && isValid(refDate)) { const daysOverdue = differenceInDays(today, refDate); if (daysOverdue <= 0) aging.ar["0-30"] += balance; else if (daysOverdue <= 30) aging.ar["0-30"] += balance; else if (daysOverdue <= 60) aging.ar["31-60"] += balance; else if (daysOverdue <= 90) aging.ar["61-90"] += balance; else aging.ar["90+"] += balance; } else { console.warn(`[Aging] Invoice ID ${inv.Id} has no valid date. Placing in 90+ bucket.`); aging.ar["90+"] += balance; } });
    openBills.forEach(bill => { const balance = safeParseFloat(bill.Balance); if (balance <= 0) return; const dueDate = parseQBDate(bill.DueDate); const txnDate = parseQBDate(bill.TxnDate); const refDate = dueDate || txnDate; aging.ap.total += balance; if (refDate && isValid(refDate)) { const daysOverdue = differenceInDays(today, refDate); if (daysOverdue <= 0) aging.ap["0-30"] += balance; else if (daysOverdue <= 30) aging.ap["0-30"] += balance; else if (daysOverdue <= 60) aging.ap["31-60"] += balance; else if (daysOverdue <= 90) aging.ap["61-90"] += balance; else aging.ap["90+"] += balance; } else { console.warn(`[Aging] Bill ID ${bill.Id} has no valid date. Placing in 90+ bucket.`); aging.ap["90+"] += balance; } });
    Object.keys(aging.ar).forEach(k => { aging.ar[k as keyof AgingData['ar']] = Math.round(aging.ar[k as keyof AgingData['ar']] * 100) / 100; }); Object.keys(aging.ap).forEach(k => { aging.ap[k as keyof AgingData['ap']] = Math.round(aging.ap[k as keyof AgingData['ap']] * 100) / 100; });
    return aging;
};


/** Calculates cash runway in months */
export const calculateRunway = (
    currentCashBalance: number,
    avgMonthlyBurn: number
): number | null => {
    const cash = currentCashBalance || 0; const burn = avgMonthlyBurn || 0;
    if (burn <= 0) return -1; if (cash <= 0) return 0;
    return cash / burn;
};


// --- List Building Functions ---

/** Builds recent activity list (Improved version) */
export const buildRecentActivity = (
    invoices: any[],
    bills: any[],
    customers: any[]
): RecentActivityItem[] => {
     const activities: RecentActivityItem[] = [];
    const customerMap = new Map(customers.map(c => [c.Id, c.DisplayName]));
    invoices.forEach(inv => { const total = safeParseFloat(inv.TotalAmt); const balance = safeParseFloat(inv.Balance); const isLikelyPaid = balance <= 0 && total > 0; const isPartiallyPaid = balance > 0 && balance < total; const date = parseQBDate(inv.TxnDate); const custName = customerMap.get(inv.CustomerRef?.value) || 'Customer'; if (date && isValid(date)) { let type = "INVOICE_CREATED"; let description = `Invoice #${inv.DocNumber || inv.Id} created for ${custName}`; let amount = total; if (isLikelyPaid) { type = "INVOICE_PAID"; description = `Invoice #${inv.DocNumber || inv.Id} balance zeroed for ${custName}`; } else if (isPartiallyPaid) { type = "INVOICE_PARTIALLY_PAID"; description = `Invoice #${inv.DocNumber || inv.Id} partially paid by ${custName}`; amount = total - balance; } activities.push({ id: inv.Id, type, description, date, amount, customerOrVendorName: custName }); } });
    bills.forEach(bill => { const date = parseQBDate(bill.TxnDate); const amount = safeParseFloat(bill.TotalAmt); const vendorName = bill.VendorRef?.name || 'Vendor'; const balance = safeParseFloat(bill.Balance); const isLikelyPaid = balance <= 0 && amount > 0; if (date && isValid(date) && amount > 0) { let type = "BILL_CREATED"; let description = `Bill #${bill.DocNumber || bill.Id} received from ${vendorName}`; let displayAmount = -amount; if (isLikelyPaid) { type = "BILL_PAID"; description = `Bill #${bill.DocNumber || bill.Id} from ${vendorName} balance zeroed`; } activities.push({ id: bill.Id, type: type, description: description, date, amount: displayAmount, customerOrVendorName: vendorName, }); } });
    return activities .sort((a, b) => b.date.getTime() - a.date.getTime()) .slice(0, 20);
};


/** Builds top customers list based on paid amounts on invoices (Cash Basis approximation) */
export const buildTopCustomers = (
    invoices: any[],
    customers: any[]
): CustomerItem[] => {
    const customerMap = new Map(customers.map(c => [c.Id, c.DisplayName])); const revenueMap = new Map<string, { id: string; name: string; revenue: number }>();
    invoices.forEach(inv => { const custRef = inv.CustomerRef?.value; if (!custRef) return; const total = safeParseFloat(inv.TotalAmt); const balance = safeParseFloat(inv.Balance); const paidAmount = total - balance; if (paidAmount > 0) { const custName = customerMap.get(custRef) || `Customer ID ${custRef}`; if (!revenueMap.has(custRef)) revenueMap.set(custRef, { id: custRef, name: custName, revenue: 0, }); revenueMap.get(custRef)!.revenue += paidAmount; } });
    return Array.from(revenueMap.values()) .sort((a, b) => b.revenue - a.revenue) .map(c => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 })) .slice(0, 10);
};


/** Extracts top expense categories from a specific P&L report column */
export const extractTopExpenseCategories = (
    report: any,
    coaMap: ChartOfAccountsMap,
    colIndex: number // Make sure this index is valid based on parsed monthColumns
): CategoryItem[] => {
    const results: CategoryItem[] = [];
     // Check colIndex validity BEFORE proceeding
    if (!report?.Rows?.Row || colIndex < 0 || colIndex >= (report.Columns?.Column?.length || 0) ) {
        console.warn(`[Top Expenses] Invalid column index (${colIndex}) or missing rows/columns.`);
        return results;
    }

    // Recursive function to find all detail rows under Expense/COGS sections
    const findExpenseRows = (rows: any[]) => {
        if (!rows) return;
        for (const row of rows) {
            // Check ColData first for detail rows
            const detailData = row.ColData;
            const headerData = row.Header?.ColData;
            const summaryData = row.Summary?.ColData;

            const titleData = headerData || detailData || summaryData; // Prefer Header > Detail > Summary for title
            const valueData = detailData; // Detail rows have values in ColData corresponding to accounts

            const title = (titleData?.[0]?.value || '').trim();
            const lowerTitle = title.toLowerCase();
            const rowId = detailData?.[0]?.id; // ID is usually on the detail row's ColData[0]
            const coaEntry = rowId ? coaMap.get(rowId) : undefined;
            const isTotalOrSummaryOrHeader = lowerTitle.startsWith('total ') || !!summaryData || !!headerData;
            const rowType = coaEntry?.accountType;

            // Check if this row is an expense/COGS detail row AND has data for the column
            if (valueData && valueData.length > colIndex && rowType && ['Expense', 'Cost of Goods Sold'].includes(rowType)) {
                const amount = safeParseFloat(valueData[colIndex]?.value); // Get amount from specified column
                 if (amount !== 0) { // Include if amount is non-zero
                     results.push({ category: title, amount: Math.abs(amount) });
                 }
            }

            // Recurse into sub-rows if they exist
            if (row.Rows?.Row) {
                findExpenseRows(row.Rows.Row);
            }
        }
    };

    // Start searching from the top level rows
    findExpenseRows(report.Rows.Row);

    // Consolidate results (sum amounts for duplicate category names, e.g. sub-accounts)
    const consolidatedMap = new Map<string, number>();
    results.forEach(item => {
        consolidatedMap.set(item.category, (consolidatedMap.get(item.category) || 0) + item.amount);
    });

    return Array.from(consolidatedMap.entries())
        .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })) // Keep cents
        .sort((a, b) => b.amount - a.amount) // Sort descending
        .slice(0, 10); // Return top 10
};