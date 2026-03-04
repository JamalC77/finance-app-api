import type {
  ParsedReportData,
  ParsedBalanceSheet,
  CoreMetrics,
  FinancialRatios,
  TrendData,
  AgingData,
  CustomerARDetail,
  ChartOfAccountsMap,
} from '../services/quickbooks/quickbooksReportParser';

// ==========================================
// QB Raw Data (in-memory only, never persisted)
// ==========================================

export interface HealthScoreRawData {
  companyName: string | null;
  industry: string | null;

  // Parsed P&L data (12 months)
  monthlyPL: ParsedReportData[];

  // Parsed Balance Sheet
  balanceSheet: ParsedBalanceSheet;

  // Chart of Accounts (for LLM normalization check)
  chartOfAccounts: ChartOfAccountsMap;

  // Core calculated metrics
  coreMetrics: CoreMetrics;
  financialRatios: FinancialRatios;
  trends: TrendData;

  // AR/AP Aging
  aging: AgingData;
  arDetails: CustomerARDetail[] | null;

  // Prior year P&L (optional)
  priorYearPL: ParsedReportData[] | null;

  // Recurring expense data (optional)
  recurringExpenses: RecurringExpenseData | null;
}

export interface RecurringExpenseData {
  totalRecurringMonthly: number;
  topVendors: Array<{
    vendorName: string;
    totalSpend: number;
    percentOfTotal: number;
    frequency: string; // 'monthly', 'weekly', 'irregular'
  }>;
  vendorConcentrationTop3Pct: number;
}

// ==========================================
// Scoring Results
// ==========================================

export interface CategoryScoreResult {
  score: number;        // 0-100
  details: string;      // Brief explanation for debugging
  modifiers: string[];  // List of applied modifiers
}

export interface HealthScoreResult {
  compositeScore: number;
  letterGrade: string;
  runwayLabel: 'Good' | 'Needs Attention' | 'Critical';

  liquidityScore: CategoryScoreResult;
  receivablesScore: CategoryScoreResult;
  revenueTrendScore: CategoryScoreResult;
  profitabilityScore: CategoryScoreResult;
  cashRunwayScore: CategoryScoreResult;

  metricsSnapshot: MetricsSnapshot;
  cashProjection: CashProjection;
}

export interface MetricsSnapshot {
  // Liquidity
  currentRatio: number | null;
  quickRatio: number | null;

  // Receivables
  ar61PlusPct: number;
  arToRevenueMonths: number;
  dso: number;

  // Revenue
  revenueTrend3m: number;   // monthly % change
  revenueTrend6m: number;
  revenueConcentrationFlag: boolean;

  // Profitability
  grossMargin: number | null;
  netMargin: number | null;
  overheadRatio: number;
  marginTrendDecline: boolean;

  // Cash Runway
  runwayMonths: number;
  monthlyBurn: number;
  cashTrendDecline: boolean;

  // Revenue range for benchmarking bucket
  revenueRange: string;  // '0-500k', '500k-1m', '1m-5m', '5m-10m', '10m+'
}

export interface CashProjection {
  currentCash: number;
  monthlyBurn: number;
  projected30d: number;
  projected60d: number;
  projected90d: number;
}

// ==========================================
// Email Payload
// ==========================================

export interface HealthScoreEmailPayload {
  companyName: string;
  email: string;
  compositeScore: number;
  letterGrade: string;
  runwayLabel: 'Good' | 'Needs Attention' | 'Critical';
  liquidityScore: number;
  receivablesScore: number;
  revenueTrendScore: number;
  profitabilityScore: number;
  cashRunwayScore: number;
  summary: string;
  cashProjection: CashProjection;
  metricsSnapshot: MetricsSnapshot;
  calendlyUrl: string;
}

// ==========================================
// API Response Types
// ==========================================

export interface HealthScoreStartResponse {
  prospectId: string;
  authUrl: string;
}

export interface HealthScoreStatusResponse {
  status: string;
  companyName?: string;
  compositeScore?: number;
  letterGrade?: string;
  errorMessage?: string;
}

export interface HealthScoreResultResponse {
  compositeScore: number;
  letterGrade: string;
  runwayLabel: string;
  liquidityScore: number;
  receivablesScore: number;
  revenueTrendScore: number;
  profitabilityScore: number;
  cashRunwayScore: number;
  summary: string;
  cashProjection: CashProjection;
  companyName: string;
  scoredAt: string;
}
