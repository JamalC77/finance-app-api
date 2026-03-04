import { getAnthropicClient } from '../utils/anthropicClient';
import { AssemblyConfigSchema, AssemblyConfig, RunwayConfig, Status } from '../types/assemblyConfig';
import { constructionDemoData } from '../data/constructionDemoData';

// In-memory cache with TTL
interface CacheEntry {
  config: AssemblyConfig;
  timestamp: number;
  source: 'ai' | 'fallback';
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class AssemblyEngineService {
  private cache: Map<string, CacheEntry> = new Map();
  private pendingGenerations: Map<string, Promise<void>> = new Map();

  async generateAssemblyConfig(
    clientId: string = 'summit-ridge-demo',
    industry: string = 'residential_construction'
  ): Promise<{ config: AssemblyConfig; source: 'ai' | 'fallback' }> {
    const cacheKey = `${clientId}:${industry}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[Assembly] Cache hit (${cached.source}) for ${cacheKey}`);
      return { config: cached.config, source: cached.source };
    }

    // No cache — return fallback immediately, generate AI in background
    const fallback = this.getFallbackConfig();

    // Cache the fallback so concurrent requests don't all trigger generation
    this.cache.set(cacheKey, {
      config: fallback,
      timestamp: Date.now(),
      source: 'fallback',
    });

    // Kick off AI generation in background (if not already running)
    if (!this.pendingGenerations.has(cacheKey)) {
      const generation = this.generateAndCache(cacheKey)
        .finally(() => this.pendingGenerations.delete(cacheKey));
      this.pendingGenerations.set(cacheKey, generation);
    }

    return { config: fallback, source: 'fallback' };
  }

  private async generateAndCache(cacheKey: string): Promise<void> {
    console.log(`[Assembly] Starting background AI generation for ${cacheKey}...`);
    const startTime = Date.now();

    try {
      const data = constructionDemoData;
      const systemPrompt = this.buildSystemPrompt();
      const userMessage = this.buildUserMessage(data);

      const response = await getAnthropicClient().messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.extractJSON(text);
      const config = AssemblyConfigSchema.parse(parsed);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Assembly] AI generation complete in ${elapsed}s — cached for ${cacheKey}`);

      this.cache.set(cacheKey, {
        config,
        timestamp: Date.now(),
        source: 'ai',
      });
    } catch (error) {
      console.error('[Assembly] Background AI generation failed:', error);
      // Fallback stays in cache — no harm done
    }
  }

  /**
   * Force-refresh: waits for AI generation to complete (used by warmup endpoint)
   */
  async warmup(
    clientId: string = 'summit-ridge-demo',
    industry: string = 'residential_construction'
  ): Promise<{ source: 'ai' | 'fallback'; elapsed: number }> {
    const cacheKey = `${clientId}:${industry}`;
    const startTime = Date.now();

    // If we already have an AI-generated config cached, return immediately
    const cached = this.cache.get(cacheKey);
    if (cached && cached.source === 'ai' && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { source: 'ai', elapsed: 0 };
    }

    // Wait for any pending generation
    const pending = this.pendingGenerations.get(cacheKey);
    if (pending) {
      await pending;
    } else {
      // Trigger one and wait
      const generation = this.generateAndCache(cacheKey)
        .finally(() => this.pendingGenerations.delete(cacheKey));
      this.pendingGenerations.set(cacheKey, generation);
      await generation;
    }

    const result = this.cache.get(cacheKey);
    return {
      source: result?.source || 'fallback',
      elapsed: Date.now() - startTime,
    };
  }

  private buildSystemPrompt(): string {
    return `You are a dashboard assembly engine for a CFO analytics platform. Your job is to analyze financial data and return a JSON configuration that determines which dashboard components to display and how to configure them.

Return ONLY valid JSON. No markdown, no explanation, no code fences. Just the JSON object.

## Industry Context: Residential Construction
Key financial priorities for residential construction companies:
- Cash timing: Draws vs subcontractor payment cycles create lumpy cash flow
- Job-level margins: Track original bid margin vs actual margin, flag variance
- WIP (Work in Progress): Over-billing vs under-billing position affects bonding capacity
- Backlog depth: Contracted work + weighted pipeline = revenue visibility
- Change orders: Unsigned COs are margin risk; track and flag
- Bonding capacity: Tied to WIP position and net worth

## Component Manifest
Each section in your config uses one of these components. You must provide the correct props for each.

### KPICard
Shows a single metric with status indicator.
Props: { label: string, value: string, status: "green"|"yellow"|"red", trend?: string, sub_text?: string }

### FlashPNL
Monthly P&L snapshot with key metrics.
Props: { period: string, revenue: number, gross_profit: number, gross_margin: number, ebitda: number, ebitda_margin: number, net_income: number, net_margin: number, ytd_revenue: number, ytd_net_income: number, budget_variance: number, revenue_growth_yoy: number }

### JobMarginTracker
Per-job margin cards showing bid vs actual margin with variance.
Props: { jobs: Array<{ id: string, name: string, contract_value: number, percent_complete: number, original_margin: number, current_margin: number, variance: number, status: "green"|"yellow"|"red", change_orders: number, completion_date: string }> }

### CashFlowTiming
Weekly cash flow chart showing draws vs commitments and running balance.
Props: { forecast: Array<{ week: string, draws: number, commitments: number, net: number, balance: number }>, min_balance: number, avg_balance: number }

### WIPSnapshot
Work-in-progress over/under billing position.
Props: { costs_in_excess: number, billings_in_excess: number, net_position: number, net_position_label: string, jobs_overbilled: number, jobs_underbilled: number }

### BacklogPipeline
Contracted backlog + weighted pipeline with revenue visibility.
Props: { contracted_backlog: number, weighted_pipeline: number, total_visibility: number, months_of_revenue: number, pipeline_jobs: Array<{ name: string, value: number, probability: number, status: string }> }

### MonthlyTrend
Revenue and margin trend over time.
Props: { data: Array<{ month: string, revenue: number, gross_margin: number, net_margin: number }> }

### ScenarioEngine
Interactive what-if analysis with slider defaults.
Props: { base_revenue: number, base_margin: number, base_forecast: Array<{ week: string, balance: number }>, defaults: { revenue_change: number, margin_change: number, delay_weeks: number } }

### Commentary
CFO notes with dates.
Props: { notes: Array<{ date: string, author: string, note: string }> }

## Alert Thresholds
- EBITDA margin: >=18% green, 12-18% yellow, <12% red
- Job margin variance: within 1% green, 1-3% yellow, >3% red
- Cash balance: >$300K green, $150-300K yellow, <$150K red
- WIP net under-billing: <$100K green, $100-200K yellow, >$200K red
- Backlog months: >6 green, 3-6 yellow, <3 red

## Assembly Config Schema
{
  "health_verdict": {
    "status": "green|yellow|red",
    "headline": "One human sentence: 'Your business is profitable but cash-vulnerable.'",
    "sub_line": "Key metrics separated by · : '14.7% revenue growth · 10% EBITDA margin · Cash thin in W3 April'",
    "priority_actions": [
      {
        "id": "unique-id",
        "headline": "Action-oriented headline",
        "detail": "One sentence with dollar impact",
        "dollar_impact": "$68K",
        "action": "Specific next step the owner can take",
        "severity": "critical|warning|info",
        "linked_section": "ComponentName (optional)",
        "linked_detail": "detail-id (optional)",
        "chat_prompt": "Question the owner can ask about this (optional)"
      }
    ]
  },
  "runway": {
    "runway_weeks": 15,
    "runway_label": "~15 weeks",
    "status": "green|yellow|red",
    "safety_threshold": 150000,
    "monthly_burn": 117000,
    "min_balance": 185000,
    "min_balance_week": "W3 May",
    "danger_weeks": ["W3 Mar", "W3 Apr", "W3 May"],
    "forecast": [
      { "week": "W1 Mar", "balance": 420000, "is_danger": false }
    ]
  },
  "executive_summary": {
    "headline": "string — one-sentence CFO summary of the business state",
    "kpis": [
      { "label": "string", "value": "string", "status": "green|yellow|red", "trend": "string (optional)", "sub_text": "string (optional)" }
    ]
  },
  "alerts": [
    { "severity": "warning|critical|info", "title": "string", "message": "string" }
  ],
  "sections": [
    { "id": "string", "title": "string", "component": "ComponentName", "priority": 1-10, "badge": "string (optional)", "props": { ... component-specific props } }
  ],
  "commentary": [
    { "date": "string", "author": "string", "note": "string" }
  ],
  "scenario_defaults": {
    "revenue_change": 0,
    "margin_change": 0,
    "delay_weeks": 0
  }
}

## Guidelines
1. Pick 6-8 sections ordered by priority (1 = highest)
2. Always include FlashPNL, JobMarginTracker, and CashFlowTiming
3. Prioritize cash flow and margins for construction
4. Generate 3 executive summary KPIs (TTM revenue, EBITDA margin, backlog months)
5. Generate alerts for any metrics that hit yellow or red thresholds
6. Write CFO commentary that references specific data points
7. Set scenario slider defaults based on current conditions
8. Use the exact prop shapes defined above — the frontend will not accept other shapes
9. Write ALL alert titles and messages in plain, conversational English — NOT accountant jargon. The audience is a business owner, not a CPA. Say "This job is losing money" not "Margin erosion detected". Say "You've done work you haven't billed for" not "WIP under-billing position". Reference specific dollar amounts and job names but explain what they mean in simple terms.
10. Always generate health_verdict with status, headline (one human sentence a business owner understands), sub_line (key metrics with · separators), and 2-3 priority_actions with dollar impact, specific action verbs, and section links.
11. Always generate runway from the cash forecast data. Calculate weeks until cash hits zero at current burn rate. Runway status: green if min balance > 2x safety threshold, yellow if > safety threshold, red if below. Mark weeks as is_danger when balance < safety_threshold + monthly_burn.
12. Priority actions must be specific and actionable — "Schedule client meeting to sign COs" not "Review change orders". Each action references a dollar amount and links to a dashboard section.
13. Health verdict headline should be one sentence: Healthy (green) = "Your business is healthy and growing." Watch (yellow) = "Your business is profitable but [specific risk]." Act Now (red) = "Your business needs immediate attention — [specific crisis]."
14. Include Cash Runway as a 4th KPI alongside TTM Revenue, EBITDA Margin, and Backlog.`;
  }

  private buildUserMessage(data: typeof constructionDemoData): string {
    return `Analyze this financial data for ${data.company.name} (${data.company.location}, ${data.company.industry}) and generate a dashboard assembly config.

Report Period: ${data.company.report_period}
TTM Revenue: $${(data.company.ttm_revenue / 1000000).toFixed(1)}M

## Flash P&L
${JSON.stringify(data.flash_pnl, null, 2)}

## Active Jobs (${data.active_jobs.length})
${JSON.stringify(data.active_jobs, null, 2)}

## 12-Week Cash Forecast
${JSON.stringify(data.cash_forecast, null, 2)}

## Monthly Trend (6 months)
${JSON.stringify(data.monthly_trend, null, 2)}

## Backlog & Pipeline
${JSON.stringify(data.backlog, null, 2)}

## WIP Position
${JSON.stringify(data.wip, null, 2)}

## CFO Notes
${JSON.stringify(data.cfo_notes, null, 2)}

Generate the assembly config JSON now.`;
  }

  private extractJSON(text: string): any {
    // Strip markdown code fences if present
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    // Find the first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON object found in response');
    }

    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    return JSON.parse(cleaned);
  }

  private calculateRunway(data: typeof constructionDemoData): RunwayConfig {
    const safetyThreshold = 150000;
    const monthlyBurn = data.flash_pnl.operating_expenses;
    const weeklyBurn = monthlyBurn / 4.33;
    const currentBalance = data.cash_forecast[0].balance;
    const runwayWeeks = Math.floor(currentBalance / weeklyBurn);

    const forecast = data.cash_forecast.map(w => ({
      week: w.week,
      balance: w.balance,
      is_danger: w.balance < safetyThreshold + monthlyBurn,
    }));

    const dangerWeeks = forecast.filter(w => w.is_danger).map(w => w.week);
    const minBalance = Math.min(...data.cash_forecast.map(w => w.balance));
    const minBalanceWeek = data.cash_forecast.find(w => w.balance === minBalance)!.week;

    const status: Status =
      minBalance < safetyThreshold ? 'red' :
      minBalance < safetyThreshold * 2 ? 'yellow' : 'green';

    return {
      runway_weeks: runwayWeeks,
      runway_label: runwayWeeks > 12 ? `${Math.round(runwayWeeks / 4.33)} months` : `~${runwayWeeks} weeks`,
      status,
      safety_threshold: safetyThreshold,
      monthly_burn: monthlyBurn,
      min_balance: minBalance,
      min_balance_week: minBalanceWeek,
      danger_weeks: dangerWeeks,
      forecast,
    };
  }

  private getFallbackConfig(): AssemblyConfig {
    const data = constructionDemoData;
    const runway = this.calculateRunway(data);

    return {
      health_verdict: {
        status: 'yellow',
        headline: 'Your business is profitable but cash-vulnerable.',
        sub_line: '14.7% revenue growth \u00b7 10% EBITDA margin \u00b7 Cash gets dangerously thin in W3 April and W3 May',
        priority_actions: [
          {
            id: 'memorial-cos',
            headline: 'Memorial Renovation margin is slipping',
            detail: '$68K in unsigned change orders \u2014 that\u2019s margin walking out the door.',
            dollar_impact: '$68K',
            action: 'Schedule client meeting to sign COs this week',
            severity: 'critical',
            linked_section: 'JobMarginTracker',
            linked_detail: 'J-2404',
            chat_prompt: 'Tell me more about Memorial Renovation',
          },
          {
            id: 'unbilled-wip',
            headline: '$312K in unbilled work across 5 jobs',
            detail: 'That\u2019s your cash sitting in someone else\u2019s pocket.',
            dollar_impact: '$312K',
            action: 'Send draw requests for under-billed jobs',
            severity: 'warning',
            linked_section: 'WIPSnapshot',
            linked_detail: 'underbilled',
            chat_prompt: 'Which jobs have unbilled work?',
          },
          {
            id: 'cash-floor',
            headline: 'Cash floor hits $185K in May',
            detail: '8 days of operating cash. Sub payments outpace draws in W3.',
            dollar_impact: '$185K floor',
            action: 'Accelerate draw requests for Westfield and Heights A',
            severity: 'warning',
            linked_section: 'CashFlowTiming',
            linked_detail: 'W3',
            chat_prompt: 'How bad could the May cash crunch get?',
          },
        ],
      },
      runway,
      executive_summary: {
        headline: `Summit Ridge Builders: $8.4M TTM revenue with margin pressure on 2 of 7 active jobs. Cash position stable but watch W3 dips.`,
        kpis: [
          { label: 'TTM Revenue', value: '$8.4M', status: 'green', trend: '+14.7% YoY', sub_text: 'Feb 2026' },
          { label: 'EBITDA Margin', value: '10.0%', status: 'red', trend: '-2% vs budget', sub_text: '$78K / $780K' },
          { label: 'Cash Runway', value: runway.runway_label, status: runway.status, trend: `Floor: $${Math.round(runway.min_balance / 1000)}K ${runway.min_balance_week}`, sub_text: `${runway.danger_weeks.length} danger weeks` },
          { label: 'Backlog', value: '7.2 mo', status: 'green', trend: '$5.1M visibility', sub_text: '$3.2M contracted' },
        ],
      },
      alerts: [
        {
          severity: 'critical',
          title: 'Memorial Renovation is losing money',
          message: 'This job\'s profit dropped from 10% to 6.5%. There\'s $68K in extra work the client hasn\'t signed off on yet — get that locked down before the next payment.',
        },
        {
          severity: 'warning',
          title: 'Cash gets tight 3 times in the next 12 weeks',
          message: 'The third week of March, April, and May all show more money going out than coming in. You\'re paying subs faster than draws come in.',
        },
        {
          severity: 'warning',
          title: 'You\'ve done $165K of work you haven\'t billed for',
          message: '5 jobs have more costs than billings. Send out those draw requests — that\'s cash sitting on the table.',
        },
      ],
      sections: [
        {
          id: 'flash-pnl',
          title: 'Flash P&L',
          component: 'FlashPNL',
          priority: 1,
          badge: 'Feb 2026',
          props: {
            period: data.flash_pnl.period,
            revenue: data.flash_pnl.revenue,
            gross_profit: data.flash_pnl.gross_profit,
            gross_margin: data.flash_pnl.gross_margin,
            ebitda: data.flash_pnl.ebitda,
            ebitda_margin: data.flash_pnl.ebitda_margin,
            net_income: data.flash_pnl.net_income,
            net_margin: data.flash_pnl.net_margin,
            ytd_revenue: data.flash_pnl.ytd_revenue,
            ytd_net_income: data.flash_pnl.ytd_net_income,
            budget_variance: data.flash_pnl.budget_variance,
            revenue_growth_yoy: data.flash_pnl.revenue_growth_yoy,
          },
        },
        {
          id: 'job-margins',
          title: 'Job Margin Tracker',
          component: 'JobMarginTracker',
          priority: 2,
          badge: '7 Active',
          props: {
            jobs: data.active_jobs.map((j) => ({
              id: j.id,
              name: j.name,
              contract_value: j.contract_value,
              percent_complete: j.percent_complete,
              original_margin: j.original_margin,
              current_margin: j.current_margin,
              variance: j.variance,
              status: j.status,
              change_orders: j.change_orders,
              completion_date: j.completion_date,
            })),
          },
        },
        {
          id: 'cash-flow',
          title: 'Cash Flow Timing',
          component: 'CashFlowTiming',
          priority: 3,
          badge: '12-Week',
          props: {
            forecast: data.cash_forecast,
            min_balance: 185000,
            avg_balance: 343000,
          },
        },
        {
          id: 'wip',
          title: 'WIP Snapshot',
          component: 'WIPSnapshot',
          priority: 4,
          props: {
            costs_in_excess: data.wip.total_costs_in_excess,
            billings_in_excess: data.wip.total_billings_in_excess,
            net_position: data.wip.net_position,
            net_position_label: data.wip.net_position_label,
            jobs_overbilled: data.wip.jobs_overbilled,
            jobs_underbilled: data.wip.jobs_underbilled,
          },
        },
        {
          id: 'backlog',
          title: 'Backlog & Pipeline',
          component: 'BacklogPipeline',
          priority: 5,
          badge: '7.2 mo',
          props: {
            contracted_backlog: data.backlog.contracted_backlog,
            weighted_pipeline: data.backlog.weighted_pipeline,
            total_visibility: data.backlog.total_visibility,
            months_of_revenue: data.backlog.months_of_revenue,
            pipeline_jobs: data.backlog.pipeline_jobs,
          },
        },
        {
          id: 'monthly-trend',
          title: 'Monthly Trend',
          component: 'MonthlyTrend',
          priority: 6,
          badge: '6 Months',
          props: {
            data: data.monthly_trend,
          },
        },
        {
          id: 'scenario',
          title: 'What-If Scenarios',
          component: 'ScenarioEngine',
          priority: 7,
          props: {
            base_revenue: data.flash_pnl.revenue,
            base_margin: data.flash_pnl.gross_margin,
            base_forecast: data.cash_forecast.map((w) => ({ week: w.week, balance: w.balance })),
            defaults: { revenue_change: 0, margin_change: 0, delay_weeks: 0 },
          },
        },
        {
          id: 'commentary',
          title: 'CFO Commentary',
          component: 'Commentary',
          priority: 8,
          props: {
            notes: data.cfo_notes,
          },
        },
      ],
      commentary: data.cfo_notes,
      scenario_defaults: { revenue_change: 0, margin_change: 0, delay_weeks: 0 },
    };
  }
}

export const assemblyEngineService = new AssemblyEngineService();
