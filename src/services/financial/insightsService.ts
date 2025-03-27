// Types from parser/controller
interface CoreMetrics {
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

interface FinancialRatios {
    netProfitMargin: number | null;
    grossProfitMargin: number | null;
    operatingProfitMargin: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    workingCapital: number;
    debtToEquity: number | null;
}

interface TrendData {
    monthlyPLData: ParsedReportData[];
    yoyIncomeChange?: number;
    yoyProfitChange?: number;
    avgMonthlyBurn: number;
}

interface AgingData {
    ar: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
    ap: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
}

interface ParsedReportData {
    month: string;
    startDate: string;
    endDate: string;
    income: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    operatingIncome: number;
    netIncome: number;
}

interface CashFlowForecastItem {
    month: string;
    projected_income: number;
    projected_expenses: number;
    projected_balance: number;
}

interface IndustryBenchmark { metric: string; average: number; /* ... */ }

interface InsightsInput {
    metrics: CoreMetrics;
    ratios: FinancialRatios;
    trends: TrendData;
    aging: AgingData;
    runway: number | null; // months
    forecast: CashFlowForecastItem[];
    benchmarks?: IndustryBenchmark[]; // Optional benchmark data
}

interface BusinessInsight {
    id: string;
    type: "critical" | "warning" | "info" | "success" | "tip";
    title: string;
    description: string;
    priority: number; // 1-10 (10=highest)
    actionLink?: string; // e.g., link to QB Invoice page or relevant section
    actionText?: string;
    relatedMetric?: string; // For potential UI linking/highlighting
}

class InsightsService {
    private insights: BusinessInsight[] = [];

    private addInsight(insight: Omit<BusinessInsight, 'id'>) {
        // Avoid adding duplicate insights if logic overlaps
        if (!this.insights.some(i => i.title === insight.title)) {
            this.insights.push({ ...insight, id: Math.random().toString(36).substring(2) });
        }
    }

     // Helper to find a benchmark value
    private getBenchmark(benchmarks: IndustryBenchmark[] | undefined, metric: string): number | undefined {
        return benchmarks?.find(b => b.metric === metric)?.average;
    }

    /**
     * Generates insights based on financial data.
     * This is a rule-based engine. Could be enhanced with ML later.
     */
    generateInsights(input: InsightsInput): BusinessInsight[] {
        this.insights = []; // Reset for each run
        const { metrics, ratios, trends, aging, runway, forecast, benchmarks } = input;

        // --- Critical Insights (Priority 9-10) ---
        if (runway !== null && runway >= 0 && runway < 1.5) {
            this.addInsight({
                type: "critical", priority: 10, title: "Critically Low Cash Runway",
                description: `Estimated cash runway is less than 1.5 months (${runway.toFixed(1)} months). Immediate action required to increase cash inflow or drastically cut costs.`,
                relatedMetric: "runwayMonths",
                actionText: "Review Expenses & AR", // Link to relevant pages?
            });
        } else if (runway !== null && runway >= 0 && runway < 3) {
             this.addInsight({
                type: "critical", priority: 9, title: "Short Cash Runway",
                description: `Estimated cash runway is less than 3 months (${runway.toFixed(1)} months). Prioritize collecting receivables and managing expenses carefully.`,
                relatedMetric: "runwayMonths",
                actionText: "Develop Cash Plan",
            });
        }

        if ((ratios.currentRatio !== null && ratios.currentRatio < 0.8) || (ratios.quickRatio !== null && ratios.quickRatio < 0.5)) {
            this.addInsight({
                type: "critical", priority: 9, title: "Potential Liquidity Crisis",
                description: `Current Ratio (${ratios.currentRatio?.toFixed(2) ?? 'N/A'}) or Quick Ratio (${ratios.quickRatio?.toFixed(2) ?? 'N/A'}) is critically low. Difficulty meeting short-term obligations is likely.`,
                relatedMetric: "liquidity",
                actionText: "Manage Cash Flow",
            });
        }

        // --- Warning Insights (Priority 6-8) ---
         if (aging.ar["90+"] > metrics.totalAR * 0.20 && metrics.totalAR > 100) { // If >20% of AR is 90+ days overdue
            this.addInsight({
                type: "warning", priority: 8, title: "High Amount of Severely Overdue Invoices",
                description: `A significant portion (${(aging.ar["90+"]/metrics.totalAR * 100).toFixed(0)}%) of your receivables is over 90 days past due. This ties up cash flow and increases risk of bad debt.`,
                relatedMetric: "agingAR",
                actionText: "Review Overdue Invoices", // Link to QB Aging report/Invoice list
            });
         } else if (aging.ar["61-90"] + aging.ar["90+"] > metrics.totalAR * 0.35 && metrics.totalAR > 100) { // If >35% of AR is 60+ days overdue
             this.addInsight({
                type: "warning", priority: 7, title: "Significant Overdue Receivables",
                description: `Over 35% of your receivables are more than 60 days past due. Focus on collection efforts for invoices aged 61+ days.`,
                relatedMetric: "agingAR",
                actionText: "Implement Collection Strategy",
            });
         }

         if (metrics.dso > 60) {
             this.addInsight({
                type: "warning", priority: 7, title: "High Days Sales Outstanding (DSO)",
                description: `Your DSO is ${metrics.dso} days, indicating it takes a long time on average to collect payments after a sale. Review credit terms and collection processes.`,
                relatedMetric: "efficiency",
                 actionText: "Analyze Payment Terms",
            });
         }
         const dsoBenchmark = this.getBenchmark(benchmarks, 'dso');
         if (dsoBenchmark && metrics.dso > dsoBenchmark * 1.3) { // >30% higher than benchmark
             this.addInsight({
                type: "warning", priority: 6, title: "DSO Significantly Higher Than Industry",
                description: `Your DSO (${metrics.dso} days) is notably higher than the industry average (${dsoBenchmark.toFixed(0)} days). This could indicate less efficient collection processes compared to peers.`,
                relatedMetric: "efficiency",
            });
         }


         if ((ratios.netProfitMargin !== null && ratios.netProfitMargin < 5) || (ratios.operatingProfitMargin !== null && ratios.operatingProfitMargin < 8)) {
             this.addInsight({
                type: "warning", priority: 6, title: "Low Profit Margins",
                description: `Your Net (${formatPercentage(ratios.netProfitMargin)}) or Operating (${formatPercentage(ratios.operatingProfitMargin)}) profit margin is low. Investigate cost structure and pricing strategy.`,
                relatedMetric: "margins",
                actionText: "Review Profitability",
            });
         }
         // Check negative trends in forecast (e.g., declining cash balance)
         if (forecast.length > 3 && forecast[forecast.length - 1].projected_balance < forecast[0].projected_balance * 0.8) {
             this.addInsight({
                type: "warning", priority: 7, title: "Forecast Shows Declining Cash Balance",
                description: `The cash flow forecast predicts a significant decrease in your cash balance over the next ${forecast.length} months. Review projected income and expenses.`,
                relatedMetric: "cashFlowForecast",
                actionText: "Analyze Forecast Details",
            });
         }


        // --- Info/Success/Tip Insights (Priority 1-5) ---
         if (runway !== null && runway < 0) { // Profitable
            this.addInsight({
                type: "success", priority: 5, title: "Cash Flow Positive",
                description: `Your business is currently generating more cash than it's spending. Consider opportunities for investment or building reserves.`,
                relatedMetric: "runwayMonths",
            });
         } else if (runway !== null && runway > 9) {
             this.addInsight({
                 type: "success", priority: 4, title: "Healthy Cash Runway",
                 description: `You have over 9 months of cash runway (${runway.toFixed(1)} months), providing a good buffer.`,
                 relatedMetric: "runwayMonths",
            });
         }

         const npmBenchmark = this.getBenchmark(benchmarks, 'netProfitMargin');
         if (ratios.netProfitMargin !== null && npmBenchmark && ratios.netProfitMargin > npmBenchmark * 1.1) {
            this.addInsight({
                type: "success", priority: 4, title: "Strong Net Profit Margin vs Industry",
                description: `Your net profit margin (${formatPercentage(ratios.netProfitMargin)}) is performing well compared to the industry average (${formatPercentage(npmBenchmark)}).`,
                relatedMetric: "margins",
            });
         }

        // Compare current month expense categories to historical average (basic anomaly)
        // This requires more data passed in or calculated in trends (e.g., avg expenses per category)
        // Example placeholder:
        // if (currentMonthTopExpenseCategory.amount > trends.avgExpenseForCategory * 1.5) {
        //     this.addInsight({ type: "info", priority: 3, title: `Higher spending in ${category}`, ... });
        // }

        if (metrics.dso < 30 && metrics.dso > 0) {
             this.addInsight({
                type: "success", priority: 4, title: "Excellent Collection Speed (Low DSO)",
                description: `Your DSO of ${metrics.dso} days indicates very efficient invoice collection.`,
                relatedMetric: "efficiency",
            });
         }

         if (ratios.quickRatio !== null && ratios.quickRatio > 1.5) {
             this.addInsight({
                 type: "tip", priority: 2, title: "High Liquidity (Quick Ratio > 1.5)",
                 description: `Your quick ratio (${ratios.quickRatio.toFixed(2)}) is strong, indicating ample liquid assets. Consider if excess cash could be deployed for growth.`,
                 relatedMetric: "liquidity",
            });
         }

        // --- Final Step: Sort by priority ---
        return this.insights.sort((a, b) => b.priority - a.priority);
    }
}

export const insightsService = new InsightsService();

// Helper function used in InsightsService
function formatPercentage(value?: number | null): string {
  if (value == null || isNaN(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}