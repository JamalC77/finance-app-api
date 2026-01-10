import { differenceInMonths, addMonths, format } from 'date-fns'; // Date utility

// Types from quickbooksReportParser (or define shared types)
interface ParsedReportData {
    month: string; // e.g., "Jan 2024"
    startDate: string;
    endDate: string;
    income: number;
    cogs: number;
    grossProfit: number;
    expenses: number; // Operating expenses (excluding COGS)
    operatingIncome: number;
    netIncome: number;
}

interface AgingBucket {
    "0-30": number;
    "31-60": number;
    "61-90": number;
    "90+": number;
    total: number;
}

// Scenario modifier types for "What-If" planning
interface ScenarioModifiers {
    // Basic multipliers
    revenueMultiplier?: number;
    expenseMultiplier?: number;
    newRecurringRevenue?: number;
    newRecurringExpense?: number;

    // Lose a customer scenario
    loseCustomer?: {
        revenueAmount: number;      // Monthly revenue lost
        effectiveMonth?: number;    // 0-based index from forecast start (default: 0 = immediate)
    };

    // New hire scenario
    newHire?: {
        role: string;
        monthlySalary: number;      // Base monthly salary
        count: number;              // Number of hires
        startMonth?: number;        // 0-based index (default: 0)
    };

    // One-time expense scenario
    oneTimeExpense?: {
        amount: number;
        month: number;              // 0-based index
        description?: string;
    };

    // Pay off debt scenario
    payoffDebt?: {
        amount: number;
        month?: number;             // 0-based index (default: 0)
    };
}

interface ForecastInput {
    historicalPL: ParsedReportData[]; // Expecting 12-24 months, sorted oldest to newest
    currentAR: AgingBucket;
    currentAP: AgingBucket;
    currentCash: number;
    forecastLengthMonths?: number; // How many months to forecast
    scenarioModifiers?: ScenarioModifiers;
}

interface CashFlowForecastItem {
    month: string; // e.g., "Apr 2025"
    projected_income: number;
    projected_expenses: number;
    projected_net_change: number; // Income - Expenses for the month
    projected_balance: number; // Running cash balance
}

const DEFAULT_FORECAST_MONTHS = 12;
const MIN_HISTORY_FOR_GROWTH = 3; // Need at least 3 months to calculate a simple growth rate

class ForecastService {

    /**
     * Calculates a simple rolling average monthly growth rate.
     * Considers the last `lookbackMonths` periods.
     * Returns 1.0 if insufficient data or no growth.
     */
    private calculateGrowthFactor(history: number[], lookbackMonths = 6): number {
        if (history.length < MIN_HISTORY_FOR_GROWTH + 1) return 1.0; // Not enough data

        const relevantHistory = history.slice(-lookbackMonths -1); // Get last N+1 points
        const growthRates: number[] = [];

        for (let i = 1; i < relevantHistory.length; i++) {
            const prev = relevantHistory[i - 1];
            const curr = relevantHistory[i];
            if (prev !== 0 && !isNaN(prev) && !isNaN(curr)) {
                 // Avoid extreme swings from near-zero bases
                if(Math.abs(prev) < 100 && Math.abs(curr - prev) > 500) {
                    // Ignore this data point - too volatile
                } else {
                    growthRates.push(curr / prev);
                }
            } else if (prev === 0 && curr > 0) {
                growthRates.push(1.5); // Assign arbitrary high growth if starting from zero
            } else if (prev === 0 && curr === 0) {
                 growthRates.push(1.0); // No change
            }
             // Handle case prev > 0 and curr === 0? Maybe push 0.5? Depends on business context.
        }

        if (growthRates.length === 0) return 1.0;

        // Simple average growth factor
        const avgGrowthRate = growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;

        // Bound the growth factor to prevent extreme projections (e.g., max 50% growth/month)
        return Math.max(0.5, Math.min(avgGrowthRate, 1.5));
    }

    /**
     * Estimates cash inflow/outflow from AR/AP aging buckets over the next few months.
     * Simple approach: Spread collections/payments over 1-3 months.
     */
     private estimateArApImpact(ar: AgingBucket, ap: AgingBucket, months: number): number[] {
        const impact = new Array(months).fill(0);

        // AR Collections (Example: Collect 70% of 0-30 in M1, 20% in M2; 50% of 31-60 in M1, 30% in M2 etc.)
        if (months > 0) impact[0] += (ar["0-30"] * 0.70) + (ar["31-60"] * 0.50) + (ar["61-90"] * 0.20) + (ar["90+"] * 0.10);
        if (months > 1) impact[1] += (ar["0-30"] * 0.20) + (ar["31-60"] * 0.30) + (ar["61-90"] * 0.30) + (ar["90+"] * 0.10);
        if (months > 2) impact[2] += (ar["0-30"] * 0.05) + (ar["31-60"] * 0.10) + (ar["61-90"] * 0.20) + (ar["90+"] * 0.10);
        // Add more sophisticated collection patterns if data is available

        // AP Payments (Example: Pay 80% of 0-30 in M1; 60% of 31-60 in M1, 30% in M2 etc.)
        if (months > 0) impact[0] -= (ap["0-30"] * 0.80) + (ap["31-60"] * 0.60) + (ap["61-90"] * 0.30) + (ap["90+"] * 0.10);
        if (months > 1) impact[1] -= (ap["31-60"] * 0.30) + (ap["61-90"] * 0.40) + (ap["90+"] * 0.20);
        if (months > 2) impact[2] -= (ap["61-90"] * 0.20) + (ap["90+"] * 0.20);

        return impact.map(val => Math.round(val)); // Round to nearest dollar
     }

    /**
     * Checks if a month appears to be incomplete based on comparing income to historical average.
     * A month with income less than 30% of the trailing average is likely incomplete.
     */
    private isIncompleteMonth(monthData: ParsedReportData, historicalPL: ParsedReportData[]): boolean {
        if (historicalPL.length < 3) return false;

        // Get trailing average (excluding the month being checked)
        const otherMonths = historicalPL.slice(0, -1);
        if (otherMonths.length === 0) return false;

        const avgIncome = otherMonths.reduce((sum, p) => sum + (p.income || 0), 0) / otherMonths.length;

        // If current month income is less than 30% of average, likely incomplete
        const currentIncome = monthData.income || 0;
        const isLikelyIncomplete = avgIncome > 0 && currentIncome < avgIncome * 0.30;

        if (isLikelyIncomplete) {
            console.log(`[ForecastService] Detected incomplete month: ${monthData.month} (income: ${currentIncome} vs avg: ${avgIncome.toFixed(0)})`);
        }

        return isLikelyIncomplete;
    }

    /**
     * Calculates trailing average for income/expenses (more stable than growth factors)
     */
    private calculateTrailingAverage(history: number[], lookbackMonths = 6): number {
        if (history.length === 0) return 0;
        const relevantHistory = history.slice(-lookbackMonths);
        return relevantHistory.reduce((sum, val) => sum + (val || 0), 0) / relevantHistory.length;
    }

    /**
     * Generates a cash flow forecast.
     */
    async generateCashFlowForecast(input: ForecastInput): Promise<CashFlowForecastItem[]> {
        const {
            historicalPL,
            currentAR,
            currentAP,
            currentCash,
            forecastLengthMonths = DEFAULT_FORECAST_MONTHS,
            scenarioModifiers = {}
        } = input;

        const forecast: CashFlowForecastItem[] = [];

        if (historicalPL.length < MIN_HISTORY_FOR_GROWTH) {
            console.warn("[ForecastService] Insufficient historical data for forecasting.");
            return [];
        }

        // 1. Check if the last month is incomplete and exclude it if so
        let effectiveHistory = [...historicalPL];
        const lastMonth = effectiveHistory[effectiveHistory.length - 1];

        if (lastMonth && this.isIncompleteMonth(lastMonth, effectiveHistory)) {
            console.log(`[ForecastService] Excluding incomplete month ${lastMonth.month} from forecast calculations`);
            effectiveHistory = effectiveHistory.slice(0, -1);
        }

        if (effectiveHistory.length < MIN_HISTORY_FOR_GROWTH) {
            console.warn("[ForecastService] Insufficient complete historical data for forecasting after excluding incomplete month.");
            return [];
        }

        // 2. Use trailing averages instead of growth factors for more stable projections
        const incomeHistory = effectiveHistory.map(p => p.income);
        const expenseHistory = effectiveHistory.map(p => p.expenses);

        // Use 6-month trailing average as baseline (more stable than growth factors)
        const avgMonthlyIncome = this.calculateTrailingAverage(incomeHistory, 6);
        const avgMonthlyExpenses = this.calculateTrailingAverage(expenseHistory, 6);

        // Calculate modest growth factor from longer-term trend (12 months)
        const baseIncomeGrowthFactor = this.calculateGrowthFactor(incomeHistory);
        const baseExpenseGrowthFactor = this.calculateGrowthFactor(expenseHistory);

        // Dampen growth factors to avoid extreme projections (cap at +/- 5% monthly)
        const dampenedIncomeGrowth = Math.max(0.95, Math.min(baseIncomeGrowthFactor, 1.05));
        const dampenedExpenseGrowth = Math.max(0.95, Math.min(baseExpenseGrowthFactor, 1.05));

        console.log(`[ForecastService] Using avg income: ${avgMonthlyIncome.toFixed(0)}, avg expenses: ${avgMonthlyExpenses.toFixed(0)}`);
        console.log(`[ForecastService] Dampened growth factors - income: ${dampenedIncomeGrowth.toFixed(3)}, expenses: ${dampenedExpenseGrowth.toFixed(3)}`);

        // 3. Extract Scenario Modifiers
        const {
            revenueMultiplier = 1.0,
            expenseMultiplier = 1.0,
            newRecurringRevenue = 0,
            newRecurringExpense = 0,
            loseCustomer,
            newHire,
            oneTimeExpense,
            payoffDebt,
        } = scenarioModifiers;

        // Start projections from trailing average (adjusted by scenario multipliers)
        let baseProjectedIncome = avgMonthlyIncome * revenueMultiplier;
        let baseProjectedExpenses = avgMonthlyExpenses * expenseMultiplier;

        // 4. Estimate AR/AP Impact for the forecast period
        const arApMonthlyImpact = this.estimateArApImpact(currentAR, currentAP, forecastLengthMonths);

        // 5. Project Future Months
        let runningCashBalance = currentCash;
        const lastComplete = effectiveHistory[effectiveHistory.length - 1];
        let currentProjectionDate = addMonths(new Date(lastComplete.endDate), 1);

        for (let i = 0; i < forecastLengthMonths; i++) {
            // Apply dampened growth factors to base projections
            baseProjectedIncome = baseProjectedIncome * dampenedIncomeGrowth + newRecurringRevenue;
            baseProjectedExpenses = baseProjectedExpenses * dampenedExpenseGrowth + newRecurringExpense;

            // Start with base projections for this month
            let monthlyIncome = baseProjectedIncome;
            let monthlyExpenses = baseProjectedExpenses;
            let oneTimeImpact = 0;

            // Apply loseCustomer modifier: reduce income starting from effectiveMonth
            if (loseCustomer) {
                const effectiveMonth = loseCustomer.effectiveMonth ?? 0;
                if (i >= effectiveMonth) {
                    monthlyIncome -= loseCustomer.revenueAmount;
                }
            }

            // Apply newHire modifier: increase expenses starting from startMonth
            // Include ~30% for benefits/taxes on top of base salary
            if (newHire) {
                const startMonth = newHire.startMonth ?? 0;
                if (i >= startMonth) {
                    const totalMonthlyCost = newHire.monthlySalary * newHire.count * 1.3;
                    monthlyExpenses += totalMonthlyCost;
                }
            }

            // Apply oneTimeExpense modifier: add expense hit in specific month
            if (oneTimeExpense && i === oneTimeExpense.month) {
                oneTimeImpact -= oneTimeExpense.amount;
            }

            // Apply payoffDebt modifier: subtract from cash in specific month
            if (payoffDebt) {
                const debtMonth = payoffDebt.month ?? 0;
                if (i === debtMonth) {
                    oneTimeImpact -= payoffDebt.amount;
                }
            }

            // Calculate net change
            const netChangeBase = monthlyIncome - monthlyExpenses;
            const arApImpactThisMonth = arApMonthlyImpact[i] || 0;
            const projectedNetChange = netChangeBase + arApImpactThisMonth + oneTimeImpact;

            // Update running balance
            runningCashBalance += projectedNetChange;

            forecast.push({
                month: format(currentProjectionDate, 'MMM yyyy'),
                projected_income: Math.round(monthlyIncome),
                projected_expenses: Math.round(monthlyExpenses),
                projected_net_change: Math.round(projectedNetChange),
                projected_balance: Math.round(runningCashBalance),
            });

            currentProjectionDate = addMonths(currentProjectionDate, 1);
        }

        return forecast;
    }
}

export const forecastService = new ForecastService();