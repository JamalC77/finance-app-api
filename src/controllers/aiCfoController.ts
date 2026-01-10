import Anthropic from "@anthropic-ai/sdk";
import { quickbooksDashboardController } from "./quickbooks/quickbooksDashboardController";
import { prisma } from "../utils/prisma";
import { ApiError } from "../utils/errors";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AskQuestionParams {
  organizationId: string;
  question: string;
  conversationHistory?: ConversationMessage[];
}

interface FinancialContext {
  companyName: string;
  cash: { balance: number; changePercentage: number };
  income: { mtd: number; changePercentage: number };
  expenses: { mtd: number; changePercentage: number };
  profitLoss: { mtd: number; changePercentage: number };
  margins: { netProfitPercent: number; grossProfitPercent: number; operatingProfitPercent: number };
  liquidity: { currentRatio: number | null; quickRatio: number | null; workingCapital: number };
  efficiency: { dso: number; dpo: number };
  agingAR: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
  agingAP: { "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
  runwayMonths: number;
  cashFlowHistory: any[];
  cashFlowForecast: any;
  topCustomers: any[];
  topExpenseCategories: any[];
  advancedMetrics: any;
  lastRefreshed: string;
}

class AiCfoController {
  /**
   * Main method to ask the AI CFO a question
   */
  async askQuestion({ organizationId, question, conversationHistory = [] }: AskQuestionParams) {
    try {
      console.log(`[AI CFO] Processing question for org ${organizationId}: "${question.substring(0, 50)}..."`);

      // 1. Fetch current financial context from QuickBooks dashboard
      const dashboardData = await quickbooksDashboardController.getDashboardData(organizationId);

      // 2. Get organization info for company name
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true }
      });

      // 3. Build financial context for Claude
      const financialContext: FinancialContext = {
        companyName: organization?.name || "Your Company",
        cash: dashboardData.cash,
        income: dashboardData.income,
        expenses: dashboardData.expenses,
        profitLoss: dashboardData.profitLoss,
        margins: dashboardData.margins,
        liquidity: dashboardData.liquidity,
        efficiency: dashboardData.efficiency,
        agingAR: dashboardData.agingAR,
        agingAP: dashboardData.agingAP,
        runwayMonths: dashboardData.runwayMonths,
        cashFlowHistory: dashboardData.cashFlowHistory.slice(-6), // Last 6 months
        cashFlowForecast: dashboardData.cashFlowForecast,
        topCustomers: dashboardData.topCustomers,
        topExpenseCategories: dashboardData.topExpenseCategories,
        advancedMetrics: dashboardData.advancedMetrics,
        lastRefreshed: dashboardData.lastRefreshed,
      };

      // 4. Build the system prompt
      const systemPrompt = this.buildSystemPrompt(financialContext);

      // 5. Build messages array with conversation history
      const messages: Anthropic.MessageParam[] = [
        ...conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        { role: "user" as const, content: question },
      ];

      // 6. Call Claude API
      console.log(`[AI CFO] Calling Claude API...`);
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages,
      });

      // 7. Extract the response text
      const assistantMessage = response.content[0].type === "text"
        ? response.content[0].text
        : "";

      console.log(`[AI CFO] Response generated successfully for org ${organizationId}`);

      return {
        answer: assistantMessage,
        financialSnapshot: {
          cashBalance: financialContext.cash.balance,
          runwayMonths: financialContext.runwayMonths,
          mtdProfitLoss: financialContext.profitLoss.mtd,
          dataAsOf: financialContext.lastRefreshed,
        },
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (err) {
      console.error(`[AI CFO] Error processing question for org ${organizationId}:`, err);

      if (err instanceof ApiError) {
        throw err;
      }

      if ((err as any)?.status === 401) {
        throw new ApiError(500, "AI service authentication failed. Please check API configuration.");
      }

      throw new ApiError(500, `Failed to process your question: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Build the system prompt with financial context
   */
  private buildSystemPrompt(context: FinancialContext): string {
    const formatCurrency = (amount: number) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

    const formatPercent = (value: number | null) =>
      value !== null ? `${value.toFixed(1)}%` : "N/A";

    return `You are an AI CFO Assistant for ${context.companyName}. You provide expert financial guidance based on real-time data from their accounting system.

## Your Personality
- You're a seasoned CFO who explains complex financial concepts in plain English
- Be direct and actionable - business owners are busy
- Always ground your advice in the actual numbers
- Flag risks proactively but don't be alarmist
- When uncertain, say so and explain what additional info would help

## Current Financial Snapshot (as of ${new Date(context.lastRefreshed).toLocaleDateString()})

### Cash Position
- Current Cash Balance: ${formatCurrency(context.cash.balance)}
- Cash Change (vs last month): ${formatPercent(context.cash.changePercentage)}
- Runway: ${context.runwayMonths.toFixed(1)} months

### This Month's Performance
- Revenue (MTD): ${formatCurrency(context.income.mtd)} (${formatPercent(context.income.changePercentage)} vs last month)
- Expenses (MTD): ${formatCurrency(context.expenses.mtd)} (${formatPercent(context.expenses.changePercentage)} vs last month)
- Net Profit/Loss (MTD): ${formatCurrency(context.profitLoss.mtd)}

### Profitability Margins
- Gross Profit Margin: ${formatPercent(context.margins.grossProfitPercent)}
- Operating Profit Margin: ${formatPercent(context.margins.operatingProfitPercent)}
- Net Profit Margin: ${formatPercent(context.margins.netProfitPercent)}

### Liquidity & Working Capital
- Current Ratio: ${context.liquidity.currentRatio?.toFixed(2) || "N/A"}
- Quick Ratio: ${context.liquidity.quickRatio?.toFixed(2) || "N/A"}
- Working Capital: ${formatCurrency(context.liquidity.workingCapital)}

### Accounts Receivable (Money Owed TO You)
- Total Outstanding: ${formatCurrency(context.agingAR.total)}
- 0-30 days: ${formatCurrency(context.agingAR["0-30"])}
- 31-60 days: ${formatCurrency(context.agingAR["31-60"])}
- 61-90 days: ${formatCurrency(context.agingAR["61-90"])}
- 90+ days (URGENT): ${formatCurrency(context.agingAR["90+"])}
- Days Sales Outstanding (DSO): ${context.efficiency.dso.toFixed(0)} days

### Accounts Payable (Money You OWE)
- Total Outstanding: ${formatCurrency(context.agingAP.total)}
- 0-30 days: ${formatCurrency(context.agingAP["0-30"])}
- 31-60 days: ${formatCurrency(context.agingAP["31-60"])}
- 61-90 days: ${formatCurrency(context.agingAP["61-90"])}
- 90+ days: ${formatCurrency(context.agingAP["90+"])}
- Days Payable Outstanding (DPO): ${context.efficiency.dpo.toFixed(0)} days

### Top Customers by Outstanding AR
${context.topCustomers.slice(0, 5).map((c, i) => `${i + 1}. ${c.name}: ${formatCurrency(c.balance)} (${c.daysOutstanding || 0} days avg)`).join("\n")}

### Top Expense Categories (This Month)
${context.topExpenseCategories.slice(0, 5).map((e, i) => `${i + 1}. ${e.name}: ${formatCurrency(e.amount)}`).join("\n")}

### Recent Cash Flow Trend (Last 6 Months)
${context.cashFlowHistory.map(m => `- ${m.month}: Revenue ${formatCurrency(m.income)}, Expenses ${formatCurrency(m.expenses)}, Net ${formatCurrency(m.netIncome)}`).join("\n")}

### Cash Flow Forecast (Next 3 Months)
${context.cashFlowForecast?.projections?.slice(0, 3).map((p: any) => `- ${p.month}: Projected Cash ${formatCurrency(p.endingCash)}`).join("\n") || "Forecast data not available"}

## Response Guidelines
1. Always cite specific numbers from the data above when relevant
2. For "can I afford X" questions, calculate the impact on runway and cash position
3. For collection priorities, rank by amount AND days overdue
4. For expense questions, compare to revenue and industry benchmarks
5. Provide a clear recommendation with reasoning
6. If a question requires data you don't have, say what's missing
7. Keep responses concise but complete - aim for 2-4 paragraphs max
8. Use bullet points for action items or multiple recommendations

Remember: You're helping a business owner make better financial decisions. Be their trusted advisor.`;
  }

  /**
   * Generate a weekly executive summary
   */
  async generateWeeklySummary(organizationId: string) {
    const question = `Generate a weekly executive summary covering:
1. Key financial highlights and concerns from the past week
2. Cash position and runway update
3. Collections that need attention (aging AR)
4. Any expenses that seem unusual or need review
5. Top 3 action items for the coming week

Keep it concise and actionable - this is for a busy CEO.`;

    return this.askQuestion({ organizationId, question });
  }

  /**
   * Analyze a potential hiring decision
   */
  async analyzeHiringDecision(organizationId: string, params: {
    role: string;
    salary: number;
    count: number;
    startMonth?: string;
  }) {
    const { role, salary, count, startMonth = "next month" } = params;
    const totalAnnualCost = salary * count * 1.3; // Include ~30% for benefits/taxes
    const monthlyCost = totalAnnualCost / 12;

    const question = `I'm considering hiring ${count} ${role}(s) at ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(salary)} base salary each, starting ${startMonth}.

Total estimated monthly cost (including benefits/taxes): ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(monthlyCost)}

Based on my current financial position:
1. Can I sustain this hire for at least 18 months?
2. What happens to my runway?
3. What revenue growth would I need to make this sustainable?
4. What's your recommendation?`;

    return this.askQuestion({ organizationId, question });
  }

  /**
   * Get collection priorities
   */
  async getCollectionPriorities(organizationId: string) {
    const question = `Based on my current accounts receivable aging:
1. Which customers should I prioritize for collections this week?
2. What's the total amount I could recover if I focus on 90+ day invoices?
3. What's my DSO trend telling me about collection efficiency?
4. Any specific customers that are becoming a risk?

Rank the priorities and give me specific action items.`;

    return this.askQuestion({ organizationId, question });
  }
}

export const aiCfoController = new AiCfoController();
