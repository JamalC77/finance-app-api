import { getAnthropicClient } from '../../utils/anthropicClient';
import type { HealthScoreResult, MetricsSnapshot, CashProjection } from '../../types/healthScore';

const MODEL = 'claude-sonnet-4-5-20250929';

class HealthScoreLlmService {
  /**
   * Generate a 3-paragraph plain-English financial health summary using Claude.
   * Falls back to a template string if the API call fails.
   */
  async generateSummary(companyName: string, result: HealthScoreResult): Promise<string> {
    try {
      const client = getAnthropicClient();
      const { metricsSnapshot: m, cashProjection: cp } = result;

      const userMessage = `
Company: ${companyName}
Composite Score: ${result.compositeScore}/100 (${result.letterGrade})
Cash Runway: "${result.runwayLabel}"

Category Scores:
1. Liquidity: ${result.liquidityScore.score}/100
   - Current Ratio: ${m.currentRatio ?? 'N/A'}
   - Quick Ratio: ${m.quickRatio ?? 'N/A'}

2. Receivables: ${result.receivablesScore.score}/100
   - AR 61+ Days Past Due: ${(m.ar61PlusPct * 100).toFixed(1)}%
   - AR-to-Revenue (months): ${m.arToRevenueMonths.toFixed(1)}
   - Days Sales Outstanding: ${m.dso.toFixed(0)} days

3. Revenue Trend: ${result.revenueTrendScore.score}/100
   - 3-Month Trend: ${(m.revenueTrend3m * 100).toFixed(1)}% monthly
   - 6-Month Trend: ${(m.revenueTrend6m * 100).toFixed(1)}% monthly
   - Revenue Concentration Flag: ${m.revenueConcentrationFlag ? 'Yes' : 'No'}

4. Profitability: ${result.profitabilityScore.score}/100
   - Gross Margin: ${m.grossMargin != null ? (m.grossMargin * 100).toFixed(1) + '%' : 'N/A'}
   - Net Margin: ${m.netMargin != null ? (m.netMargin * 100).toFixed(1) + '%' : 'N/A'}
   - Overhead Ratio: ${(m.overheadRatio * 100).toFixed(1)}%
   - Margin Trend Declining: ${m.marginTrendDecline ? 'Yes' : 'No'}

5. Cash Runway: ${result.cashRunwayScore.score}/100
   - Runway: ${m.runwayMonths.toFixed(1)} months
   - Monthly Burn: $${Math.round(m.monthlyBurn).toLocaleString()}
   - Cash Trend Declining: ${m.cashTrendDecline ? 'Yes' : 'No'}

Cash Projection:
- Current Cash: $${Math.round(cp.currentCash).toLocaleString()}
- 30-Day Projected: $${Math.round(cp.projected30d).toLocaleString()}
- 60-Day Projected: $${Math.round(cp.projected60d).toLocaleString()}
- 90-Day Projected: $${Math.round(cp.projected90d).toLocaleString()}

Instructions: Write exactly 3 paragraphs. Paragraph 1: overall assessment of the company's financial health. Paragraph 2: the 1-2 most significant findings, citing specific numbers from the data above. Paragraph 3: a single sentence suggesting a deeper diagnostic could uncover actionable improvements. Keep the total under 200 words. No bullet points, no headers, no bold text. Write in natural paragraphs only.`.trim();

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: 'You are a financial analyst writing a brief, plain-English financial health summary for a small business owner. Be direct and clear. No jargon. No hedging. State what\'s strong and what\'s concerning.',
        messages: [
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return text;
    } catch (error) {
      console.error('[HealthScoreLlmService] Failed to generate summary:', error);
      return `Your Financial Health Score is ${result.compositeScore}/100 (${result.letterGrade}). Your cash runway is rated "${result.runwayLabel}." Based on the data from your accounting system, your liquidity score is ${result.liquidityScore.score}, receivables score is ${result.receivablesScore.score}, revenue trend score is ${result.revenueTrendScore.score}, profitability score is ${result.profitabilityScore.score}, and cash runway score is ${result.cashRunwayScore.score}. A detailed diagnostic call can help identify the specific actions to strengthen your financial position.`;
    }
  }

  /**
   * Normalize ambiguous chart-of-accounts category names into standard buckets.
   * Only called when >30% of categories have generic names.
   * Returns an array of mappings or null on failure.
   */
  async normalizeChartOfAccounts(
    categories: Array<{ name: string; total: number }>
  ): Promise<Array<{ original_name: string; bucket: string; confidence: number }> | null> {
    try {
      const client = getAnthropicClient();

      const categoryList = categories
        .map((c) => `- "${c.name}": $${Math.round(c.total).toLocaleString()}`)
        .join('\n');

      const userMessage = `
Below is a list of expense/income categories from a small business's chart of accounts, along with their total amounts. Many of these names are generic or ambiguous.

For each category, classify it into ONE of these standard buckets:
- COGS (Cost of Goods Sold)
- PAYROLL (Salaries, wages, benefits, payroll taxes)
- RENT_FACILITIES (Rent, lease, utilities, office expenses)
- MARKETING (Advertising, marketing, promotions)
- SOFTWARE_TECH (Software, SaaS, technology, IT)
- PROFESSIONAL_SERVICES (Legal, accounting, consulting)
- INSURANCE (Insurance premiums)
- TRAVEL_MEALS (Travel, meals, entertainment)
- VEHICLE (Vehicle, fuel, auto expenses)
- DEBT_SERVICE (Loan payments, interest)
- DEPRECIATION (Depreciation, amortization)
- REVENUE (Sales, service revenue, income)
- OTHER_EXPENSE (Anything that doesn't fit above)
- OTHER_INCOME (Non-operating income, interest income)
- UNCATEGORIZED (Truly cannot determine)

Categories:
${categoryList}

Respond with a JSON array only, no other text. Each element should have:
- "original_name": the exact category name as given
- "bucket": one of the standard buckets above
- "confidence": a number from 0.0 to 1.0 indicating how confident you are in the classification
`.trim();

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        messages: [
          { role: 'user', content: userMessage },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Extract JSON from the response (handle possible markdown code fences)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[HealthScoreLlmService] Could not extract JSON array from normalizeChartOfAccounts response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        original_name: string;
        bucket: string;
        confidence: number;
      }>;

      return parsed;
    } catch (error) {
      console.error('[HealthScoreLlmService] Failed to normalize chart of accounts:', error);
      return null;
    }
  }
}

export const healthScoreLlmService = new HealthScoreLlmService();
