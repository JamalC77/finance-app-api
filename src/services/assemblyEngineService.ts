import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { AssemblyConfigSchema, AssemblyConfig } from '../types/assemblyConfig';
import { constructionDemoData } from '../data/constructionDemoData';

// Ensure env vars are loaded
if (!process.env.VERCEL) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  }
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
9. Write ALL alert titles and messages in plain, conversational English — NOT accountant jargon. The audience is a business owner, not a CPA. Say "This job is losing money" not "Margin erosion detected". Say "You've done work you haven't billed for" not "WIP under-billing position". Reference specific dollar amounts and job names but explain what they mean in simple terms.`;
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

  private getFallbackConfig(): AssemblyConfig {
    const data = constructionDemoData;

    return {
      executive_summary: {
        headline: `Summit Ridge Builders: $8.4M TTM revenue with margin pressure on 2 of 7 active jobs. Cash position stable but watch W3 dips.`,
        kpis: [
          { label: 'TTM Revenue', value: '$8.4M', status: 'green', trend: '+14.7% YoY', sub_text: 'Feb 2026' },
          { label: 'EBITDA Margin', value: '10.0%', status: 'red', trend: '-2% vs budget', sub_text: '$78K / $780K' },
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
