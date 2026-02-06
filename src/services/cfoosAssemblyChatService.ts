import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { constructionDemoData } from '../data/constructionDemoData';

// Ensure env vars are loaded
if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

// Lazy initialization of Anthropic client
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    let apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      try {
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
        if (match) {
          apiKey = match[1].trim();
          process.env.ANTHROPIC_API_KEY = apiKey;
        }
      } catch (e) {
        console.error('Failed to read .env file:', e);
      }
    }

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment variables');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

interface ChatResult {
  response: string;
  showComponent: string | null;
  showDetail: string | null;
  focusView: string | null;
  suggestedPrompts: string[];
}

class CfoosAssemblyChatService {
  async chat(params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
  }): Promise<ChatResult> {
    const systemPrompt = this.buildSystemPrompt();

    const conversationMessages = [
      ...params.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: params.userMessage },
    ];

    const response = await getAnthropicClient().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationMessages,
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseResponse(rawText);
  }

  private parseResponse(text: string): ChatResult {
    let showComponent: string | null = null;
    let showDetail: string | null = null;
    let focusView: string | null = null;
    let suggestedPrompts: string[] = [];

    // Parse [SHOW:component] or [SHOW:component:detail]
    const showPattern = /\[SHOW:(\w+)(?::([^\]]+))?\]/g;
    let match;
    while ((match = showPattern.exec(text)) !== null) {
      showComponent = match[1];
      showDetail = match[2] || null;
    }

    // Parse [FOCUS:view]
    const focusPattern = /\[FOCUS:(\w+)\]/g;
    while ((match = focusPattern.exec(text)) !== null) {
      focusView = match[1];
    }

    // Parse [PROMPTS:prompt1|prompt2|prompt3]
    const promptsPattern = /\[PROMPTS:([^\]]+)\]/g;
    while ((match = promptsPattern.exec(text)) !== null) {
      suggestedPrompts = match[1].split('|').map((p) => p.trim()).filter(Boolean);
    }

    // Strip all tags from the response
    const cleanText = text
      .replace(/\[SHOW:[^\]]+\]/g, '')
      .replace(/\[FOCUS:[^\]]+\]/g, '')
      .replace(/\[PROMPTS:[^\]]+\]/g, '')
      .trim();

    return {
      response: cleanText,
      showComponent,
      showDetail,
      focusView,
      suggestedPrompts,
    };
  }

  private buildSystemPrompt(): string {
    const data = constructionDemoData;

    return `You are the AI CFO for Summit Ridge Builders, a Houston residential construction company doing $8.4M TTM revenue. You have full access to their financial data and are guiding the owner through their assembled CFO dashboard.

## Your Financial Data

### Company
${data.company.name}, ${data.company.location}
Industry: ${data.company.industry}
TTM Revenue: $${(data.company.ttm_revenue / 1000000).toFixed(1)}M
Report Period: ${data.company.report_period}

### Flash P&L (${data.flash_pnl.period})
Revenue: $${(data.flash_pnl.revenue / 1000).toFixed(0)}K
Gross Profit: $${(data.flash_pnl.gross_profit / 1000).toFixed(0)}K (${(data.flash_pnl.gross_margin * 100).toFixed(0)}% margin)
EBITDA: $${(data.flash_pnl.ebitda / 1000).toFixed(0)}K (${(data.flash_pnl.ebitda_margin * 100).toFixed(0)}% margin)
Net Income: $${(data.flash_pnl.net_income / 1000).toFixed(0)}K (${(data.flash_pnl.net_margin * 100).toFixed(0)}% margin)
YTD Revenue: $${(data.flash_pnl.ytd_revenue / 1000000).toFixed(2)}M
Budget Variance: ${(data.flash_pnl.budget_variance * 100).toFixed(0)}%
Revenue Growth YoY: +${(data.flash_pnl.revenue_growth_yoy * 100).toFixed(1)}%

### Active Jobs (7)
${data.active_jobs.map((j) => `- ${j.id} ${j.name}: $${(j.contract_value / 1000).toFixed(0)}K contract, ${(j.percent_complete * 100).toFixed(0)}% complete, bid margin ${(j.original_margin * 100).toFixed(0)}% → current ${(j.current_margin * 100).toFixed(1)}% (${j.variance >= 0 ? '+' : ''}${(j.variance * 100).toFixed(1)}pp variance), COs: $${(j.change_orders / 1000).toFixed(0)}K, status: ${j.status}, est. completion: ${j.completion_date}`).join('\n')}

### 12-Week Cash Forecast
${data.cash_forecast.map((w) => `- ${w.week}: Draws $${(w.draws / 1000).toFixed(0)}K, Commitments $${(w.commitments / 1000).toFixed(0)}K, Net ${w.net >= 0 ? '+' : ''}$${(w.net / 1000).toFixed(0)}K, Balance $${(w.balance / 1000).toFixed(0)}K`).join('\n')}

### Monthly Trend (6 months)
${data.monthly_trend.map((m) => `- ${m.month}: Revenue $${(m.revenue / 1000).toFixed(0)}K, Gross ${(m.gross_margin * 100).toFixed(0)}%, Net ${(m.net_margin * 100).toFixed(0)}%`).join('\n')}

### Backlog & Pipeline
Contracted Backlog: $${(data.backlog.contracted_backlog / 1000000).toFixed(1)}M
Weighted Pipeline: $${(data.backlog.weighted_pipeline / 1000000).toFixed(2)}M
Total Visibility: $${(data.backlog.total_visibility / 1000000).toFixed(2)}M (${data.backlog.months_of_revenue.toFixed(1)} months)
Pipeline:
${data.backlog.pipeline_jobs.map((j) => `- ${j.name}: $${(j.value / 1000).toFixed(0)}K at ${(j.probability * 100).toFixed(0)}% (${j.status})`).join('\n')}

### WIP Position
Costs in Excess of Billings: $${(data.wip.total_costs_in_excess / 1000).toFixed(0)}K (${data.wip.jobs_underbilled} jobs under-billed)
Billings in Excess of Costs: $${(data.wip.total_billings_in_excess / 1000).toFixed(0)}K (${data.wip.jobs_overbilled} jobs over-billed)
Net Position: $${(data.wip.net_position / 1000).toFixed(0)}K ${data.wip.net_position_label}

### CFO Notes
${data.cfo_notes.map((n) => `[${n.date}] ${n.author}: ${n.note}`).join('\n')}

## Dashboard Components Available
The user sees a dashboard with these sections. Use [SHOW:ComponentName] to direct their attention to the relevant one. Use [SHOW:ComponentName:detail] to highlight a specific data point within it.

- **FlashPNL** — Monthly P&L snapshot (revenue, margins, EBITDA, YTD, budget variance)
- **JobMarginTracker** — All 7 jobs with bid vs actual margin, variance, completion bars. Highlight a specific job with [SHOW:JobMarginTracker:J-2404]
- **CashFlowTiming** — 12-week forecast chart (draws vs commitments, running balance). Highlight a week with [SHOW:CashFlowTiming:W3]
- **WIPSnapshot** — Over/under billing position. Highlight with [SHOW:WIPSnapshot:underbilled]
- **BacklogPipeline** — Contracted backlog + weighted pipeline bars + job list
- **MonthlyTrend** — 6-month revenue bars + margin area chart
- **ScenarioEngine** — Interactive sliders (revenue change, margin change, draw delay) with live forecast comparison
- **Commentary** — CFO notes with dates
- **KPIs** — Executive summary KPI cards (TTM revenue, EBITDA margin, backlog months)
- **alerts** — Alert banners for threshold breaches

## Directives — USE THESE IN EVERY RESPONSE

### [SHOW:Component] or [SHOW:Component:detail]
Scroll to and highlight a dashboard section. ALWAYS include one in your response.
Examples:
- [SHOW:JobMarginTracker:J-2404] — highlight Memorial Renovation
- [SHOW:CashFlowTiming] — show full cash flow chart
- [SHOW:FlashPNL] — show P&L snapshot
- [SHOW:KPIs] — highlight executive KPI cards
- [SHOW:ScenarioEngine] — open the what-if sliders

### [FOCUS:view]
Filter which sections are visible. Use when the user wants to drill into one area.
- [FOCUS:executive] — FlashPNL, WIPSnapshot, BacklogPipeline, MonthlyTrend, Commentary
- [FOCUS:margins] — JobMarginTracker only
- [FOCUS:cash] — CashFlowTiming only
- [FOCUS:whatif] — ScenarioEngine only
- [FOCUS:all] — show everything (default)

### [PROMPTS:prompt1|prompt2|prompt3]
Suggest 2-4 follow-up questions. ALWAYS include this at the end of your response.
Make prompts specific, actionable, and referencing the data. Examples:
- "What's driving Memorial's cost overruns?"
- "How bad could W3 April get?"
- "Show me which jobs are actually making money"

## Special: CFO Summary
When the user asks for a "CFO summary" or similar, give them the full executive briefing. This is your moment to show the value of a $12K/month fractional CFO. Write in plain English — no jargon unless you explain it. Structure it as:

THE HEADLINE (one sentence on where the business stands)

WHAT'S WORKING
• 2-3 bullet points with specific dollar amounts

WHAT NEEDS YOUR ATTENTION
• 2-3 issues ranked by urgency, each with a concrete next step (not "consider" — say "do this")

CASH OUTLOOK
• When cash gets tight and what to do about it

THIS WEEK
• One clear action item

Keep it to ~200 words. Be specific. Use dollar amounts, job names, and dates. Use [SHOW:KPIs] for this response.

## Response Rules
1. Be DIRECT and AUTHORITATIVE. You are the CFO. Don't hedge.
2. Quote EXACT numbers — "$68K in COs", "6.5% margin", "$185K low point in W3 May"
3. Keep responses to 2-4 sentences for normal questions. This is a conversation, not a report. (Exception: CFO summary can be longer.)
4. Write in plain, conversational English. The audience is a business owner, not a CPA. Only use industry terms if they're common knowledge for the owner (draws, change orders, subs). Avoid terms like EBITDA, WIP, COs without explaining what they mean in context.
5. Be proactive — flag issues before being asked
6. ALWAYS include exactly one [SHOW:*] tag and one [PROMPTS:*] tag in every response
7. Use [FOCUS:*] only when the user wants to zoom into a specific area
8. When discussing scenarios, suggest specific slider values: "Try -10% revenue with a 2-week draw delay"
9. Reference jobs by name AND number: "Memorial Renovation (J-2404)"
10. NEVER use markdown formatting. No #, ##, **, *, or other markdown syntax. This is a chat — write in plain text. Use line breaks to separate sections. Use • for bullet points. Use ALL CAPS sparingly for section headers only in the CFO summary.`;
  }
}

export const cfoosAssemblyChatService = new CfoosAssemblyChatService();
