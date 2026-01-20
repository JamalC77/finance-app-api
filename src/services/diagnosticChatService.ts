import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { prisma } from "../utils/prisma";
import { ConversationStage, LeadStatus, ChatSession, ChatMessage } from "@prisma/client";

// Ensure env vars are loaded before using them
if (!process.env.VERCEL) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  if (result.error) {
    console.error("Error loading .env file:", result.error);
  }
}

// Lazy initialization of Anthropic client
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    let apiKey = process.env.ANTHROPIC_API_KEY;

    // If env var not set, try to read directly from .env file
    if (!apiKey) {
      try {
        const envPath = path.resolve(process.cwd(), ".env");
        const envContent = fs.readFileSync(envPath, "utf8");
        const match = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
        if (match) {
          apiKey = match[1].trim();
          process.env.ANTHROPIC_API_KEY = apiKey;
        }
      } catch (e) {
        console.error("Failed to read .env file:", e);
      }
    }

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// Pain point categories for tracking
export type PainPointCategory =
  | "CASH_FLOW"
  | "PROFITABILITY"
  | "TRUST_IN_NUMBERS"
  | "AR_COLLECTIONS"
  | "EXPENSE_CONTROL"
  | "GROWTH_DECISIONS"
  | "TAX_PLANNING"
  | "OTHER";

// Quick prompt configurations by stage and pain point
// Targeting $5-10M ARR businesses
const INITIAL_QUICK_PROMPTS = [
  "Cash feels tight even though we're growing",
  "I can't tell which customers are actually profitable",
  "I'm not sure we can afford our next hire",
  "I don't trust my numbers",
];

const CONTEXTUAL_QUICK_PROMPTS: Record<PainPointCategory, string[]> = {
  CASH_FLOW: [
    "How does cash conversion cycle work?",
    "What's causing the tightness?",
    "How much cash reserve should I have?",
  ],
  PROFITABILITY: [
    "What margins should I be hitting?",
    "Where do margin leaks usually hide?",
    "How do I know if we're really profitable?",
  ],
  TRUST_IN_NUMBERS: [
    "What should clean books look like?",
    "How often should I reconcile?",
    "What reports should I be reviewing?",
  ],
  AR_COLLECTIONS: [
    "What's a healthy DSO?",
    "How do I prioritize collections?",
    "When should I write off bad debt?",
  ],
  EXPENSE_CONTROL: [
    "What's a reasonable overhead ratio?",
    "How do I spot unnecessary costs?",
    "Should I cut costs or invest in growth?",
  ],
  GROWTH_DECISIONS: [
    "Can I afford to hire right now?",
    "How do I know when to expand?",
    "What metrics should drive growth decisions?",
  ],
  TAX_PLANNING: [
    "How can I reduce my tax burden legally?",
    "Should I consider an S-corp election?",
    "What deductions am I probably missing?",
  ],
  OTHER: [
    "Tell me more about your services",
    "What's a Financial Diagnostic?",
    "How much does this typically cost?",
  ],
};

interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

// Demo panel types for the interactive demo
type DemoPanelType = 'cashflow' | 'pnl' | 'ar' | 'providers' | null;
type DemoHighlightType = 'janfeb' | 'conversion' | 'metrics' | 'margin' | 'services' | 'aging' | 'utilization' | 'drpark' | null;

interface SendMessageResult {
  response: string;
  quickPrompts: string[];
  stage: ConversationStage;
  ctaOffered: boolean;
  demoPanel?: DemoPanelType;
  demoHighlight?: DemoHighlightType;
}

class DiagnosticChatService {
  /**
   * Start a new chat session or resume an existing one
   */
  async startOrResumeSession(params: {
    sessionId: string;
    source?: string;
    utmCampaign?: string;
    utmMedium?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    sessionId: string;
    messages: Array<{ role: string; content: string; timestamp: Date }>;
    isReturningVisitor: boolean;
    quickPrompts: string[];
  }> {
    const { sessionId, source, utmCampaign, utmMedium, ipAddress, userAgent } = params;

    // Check for existing session
    let session = await prisma.chatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (session) {
      // Returning visitor
      await prisma.chatSession.update({
        where: { id: session.id },
        data: {
          isReturningVisitor: true,
          lastMessageAt: new Date(),
        },
      });

      return {
        sessionId: session.sessionId,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.createdAt,
        })),
        isReturningVisitor: true,
        quickPrompts: this.getQuickPromptsForSession(session),
      };
    }

    // Create new session with greeting
    const greeting = this.generateGreeting();

    // Create lead record first if we have any tracking data
    let leadId: string | undefined;
    if (source || utmCampaign) {
      const lead = await prisma.lead.create({
        data: {
          source,
          utmCampaign,
          utmMedium,
          status: "NEW",
        },
      });
      leadId = lead.id;
    }

    session = await prisma.chatSession.create({
      data: {
        sessionId,
        stage: "GREETING",
        leadId,
        ipAddress,
        userAgent,
        messages: {
          create: {
            role: "assistant",
            content: greeting,
            metadata: { quickPrompts: INITIAL_QUICK_PROMPTS },
          },
        },
      },
      include: { messages: true },
    });

    return {
      sessionId: session.sessionId,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      })),
      isReturningVisitor: false,
      quickPrompts: INITIAL_QUICK_PROMPTS,
    };
  }

  /**
   * Process a user message and generate AI response
   */
  async sendMessage(sessionId: string, userMessage: string): Promise<SendMessageResult> {
    // Get session with messages
    const session = await prisma.chatSession.findUnique({
      where: { sessionId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        lead: true,
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Save user message
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: userMessage,
      },
    });

    // Extract pain points and entities from user message
    const extractedData = this.extractDataFromMessage(userMessage, session);

    // Update session with new pain points
    const updatedPainPoints = [...new Set([...session.painPoints, ...extractedData.painPoints])];

    // Determine next conversation stage
    const nextStage = this.determineNextStage(session, extractedData);

    // Check if we should offer CTA
    const shouldOfferCta = this.shouldOfferCta(session, extractedData);

    // Build conversation history for Claude
    const conversationHistory = session.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Generate AI response
    const systemPrompt = this.buildSystemPrompt(session, nextStage, shouldOfferCta);

    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: systemPrompt,
      messages: [
        ...conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: userMessage },
      ],
    });

    const rawAssistantMessage = response.content[0].type === "text"
      ? response.content[0].text
      : "";

    // Parse any [SHOW:*] tags from the AI response
    const { cleanMessage: assistantMessage, demoPanel, demoHighlight } = this.parseDemoTags(rawAssistantMessage);

    // Determine quick prompts for next turn
    const quickPrompts = this.getQuickPromptsForStage(nextStage, updatedPainPoints);

    // Save assistant message (with tags stripped)
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: assistantMessage,
        metadata: {
          quickPrompts,
          stage: nextStage,
          ctaOffered: shouldOfferCta,
          demoPanel,
          demoHighlight,
        },
        tokenCount: response.usage.output_tokens,
      },
    });

    // Update session
    const newMessageCount = session.messageCount + 2; // user + assistant
    const newEngagementScore = this.calculateEngagementScore(session, newMessageCount, extractedData);

    await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        stage: nextStage,
        painPoints: updatedPainPoints,
        messageCount: newMessageCount,
        engagementScore: newEngagementScore,
        ctaOffered: shouldOfferCta || session.ctaOffered,
        lastMessageAt: new Date(),
        collectedData: {
          ...(session.collectedData as object || {}),
          ...extractedData.collectedData,
        },
      },
    });

    // Update lead score if lead exists
    if (session.leadId) {
      await this.updateLeadScore(session.leadId, newEngagementScore, updatedPainPoints);
    }

    return {
      response: assistantMessage,
      quickPrompts,
      stage: nextStage,
      ctaOffered: shouldOfferCta,
      demoPanel,
      demoHighlight,
    };
  }

  /**
   * Track Calendly click
   */
  async trackCalendlyClick(sessionId: string): Promise<void> {
    const session = await prisma.chatSession.findUnique({
      where: { sessionId },
    });

    if (session) {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { calendlyClicked: true },
      });

      if (session.leadId) {
        await prisma.lead.update({
          where: { id: session.leadId },
          data: {
            status: "DIAGNOSTIC_OFFERED",
            leadScore: { increment: 25 },
          },
        });
      }
    }
  }

  /**
   * Capture lead information
   */
  async captureLeadInfo(sessionId: string, info: {
    email?: string;
    name?: string;
    companyName?: string;
    phoneNumber?: string;
  }): Promise<void> {
    const session = await prisma.chatSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.leadId) {
      // Update existing lead
      await prisma.lead.update({
        where: { id: session.leadId },
        data: {
          ...info,
          status: "ENGAGED",
          leadScore: { increment: 15 },
        },
      });
    } else {
      // Create new lead
      const lead = await prisma.lead.create({
        data: {
          ...info,
          status: "ENGAGED",
          leadScore: 15,
        },
      });

      await prisma.chatSession.update({
        where: { id: session.id },
        data: { leadId: lead.id },
      });
    }
  }

  // ==========================================
  // Private helper methods
  // ==========================================

  private generateGreeting(): string {
    return "What's on your mind about your business finances? I'm here to help you think through whatever's keeping you up at night.";
  }

  private buildSystemPrompt(
    session: ChatSessionWithMessages,
    stage: ConversationStage,
    shouldOfferCta: boolean
  ): string {
    return `You are a diagnostic financial advisor for The CFO Line, helping business owners identify financial pain points and understand their financial situation.

## Your Role
You're not selling - you're diagnosing. Help prospects understand their financial situation clearly. Provide genuine value through frameworks, benchmarks, and insights. The right next step will emerge naturally from an honest conversation.

## What We Offer (for context, not to pitch unprompted)
The CFO Line provides fractional finance leadership:

**Books** ($2,500/mo) - Monthly bookkeeping, reconciliations, close-ready books, payroll coordination
**Close** ($4,750/mo) - Owns month-end close, reporting pack, variance analysis, payroll coordination, monthly review call
**Strategy** ($7,000/mo) - Cash forecasting, scenario modeling, board prep, strategic guidance, payroll coordination

Add-ons available for AP/AR management, multi-entity, and inventory.

**Financial Diagnostic** ($2,500) - Entry point that delivers a one-page CFO Brief with cash analysis, priority fixes, and recommended approach. Credited toward first month.

Only discuss pricing/services if directly asked. Focus on understanding their situation first.

## Conversation Approach
1. Ask ONE diagnostic question at a time
2. Listen for specific pain indicators
3. Provide genuine value through frameworks and benchmarks
4. Quantify stakes when you have enough information
5. Only present the diagnostic offer when it naturally fits

## Financial Frameworks to Share (when relevant)

**Cash Conversion Cycle**: Days Inventory + Days Receivables - Days Payables
- For service businesses: Focus on DSO (Days Sales Outstanding)
- Target: Under 45 days for most service businesses, under 30 is best-in-class

**Margin Analysis**:
- Gross margin: 50-70% for services, 30-50% for product businesses
- Net margin: 10-20% for healthy growing businesses
- Each 1% improvement at $7M revenue = $70K/year

**AR Aging Significance**:
- 0-30 days: Healthy
- 31-60 days: Watch closely
- 61-90 days: Active intervention needed
- 90+ days: Often 50%+ uncollectible

**Hiring Decision Framework**:
- Fully-loaded cost = salary × 1.3-1.4 (benefits, taxes, overhead)
- Should see 3-5x return on that investment
- Frame as "will it pay for itself" not just "can we afford it"

**Month-End Close**:
- Best practice: 5-7 business days after month end
- If taking 3+ weeks, you're making decisions on stale data

## Industry Benchmarks
- Average DSO: 42 days (good: under 30)
- Average gross margin: 55% (varies by industry)
- Average net margin: 8-12%
- Finance function cost: Typically 2-4% of revenue
- Cash reserve: 3-6 months operating expenses

## Quantifying Stakes
When you identify a problem area, help them understand the dollar impact:
- High AR aging: "Every $100K sitting in 60+ day receivables costs roughly $8K/year in opportunity cost, plus 30% write-off risk"
- Cash flow gaps: "A 10-day improvement in your cash conversion cycle at $7M revenue frees up roughly $190K in working capital"
- Margin leakage: "A 2% margin improvement on $6M revenue = $120K straight to the bottom line"
- Month-end delays: "If you're making decisions on 45-day-old data, you're flying blind"

## Current Conversation Context
Stage: ${stage}
Pain Points Identified: ${session.painPoints.join(", ") || "None yet"}
Message Count: ${session.messageCount}
${session.collectedData ? `Collected Data: ${JSON.stringify(session.collectedData)}` : ""}

## Booking a Call
When someone expresses interest in talking further, learning more about services, getting help, or wants to discuss their situation in detail, proactively suggest booking a discovery call. Say something like:

"Let's hop on a quick call to talk through your situation - I can give you much more specific guidance once I understand your numbers. You can book 30 minutes here: ${process.env.CALENDLY_URL || "https://calendly.com/cfoline"}"

Be proactive about this - don't wait for them to ask. If they seem engaged and have a real problem, suggest the call.

${shouldOfferCta ? `
## CTA Instruction
The conversation has reached a natural point where presenting the diagnostic offer OR booking a call makes sense. When appropriate, either:

1. Suggest booking a call: "It sounds like we could really help. Want to grab 30 minutes to talk through your situation? You can book directly here: ${process.env.CALENDLY_URL || "https://calendly.com/cfoline"}"

2. Or offer the diagnostic: "Based on what you've described, it sounds like [specific issue with estimated dollar impact]. Our Financial Diagnostic would give you a clear picture of where the leaks are and a roadmap to fix them. It's $2,500 and gets credited toward your first month if you decide to work with us."

The call is often the better first step - it's free and lets us understand their situation better.
` : ""}

## CRITICAL: What You Must NEVER Reveal or Imply
- Never mention revenue minimums, ideal client size, or that we target specific revenue ranges
- Never say "you might be too small" or "you might not be a fit" based on size
- Never discuss our internal capacity, margins, or business model
- If someone seems outside our target market, still be helpful - just don't push toward services

## What You Should NOT Do
- Don't ask for contact info early (let them offer it)
- Don't be pushy or salesy
- Don't pretend to have answers you don't have
- Don't diagnose specific amounts without seeing real numbers
- Don't promise specific outcomes
- Don't write long responses - keep it conversational (2-4 sentences typical)
- Don't mention internal business logic or qualification criteria
- Don't make the prospect feel "evaluated" or "scored"

## Response Style
- Conversational, not corporate
- Concise (2-4 sentences typical, never more than a short paragraph)
- Ask follow-up questions to understand their specific situation
- Acknowledge their challenges empathetically - growth is hard
- Use "you/your" not "one/one's"
- Match their energy - if they're frustrated, acknowledge it
- Treat every prospect with respect regardless of their business size

## Interactive Demo Dashboard - USE THIS EAGERLY!
When a prospect mentions a problem, SHOW them what you're talking about! The demo shows data from "Glow Aesthetics" - a $3.88M med spa with 2 locations.

**BE PROACTIVE**: As soon as someone mentions cash flow, profitability, collections, margins, or team performance - show the relevant dashboard.

**CRITICAL RULE: Only reference data that appears on the SPECIFIC panel you're showing!**

Each panel shows DIFFERENT data. When you use a [SHOW:*] tag, ONLY mention the numbers that are actually visible on that panel:

---
**[SHOW:pnl] or [SHOW:pnl:metrics] - P&L Panel shows:**
- 4 metric cards: TTM Revenue $3.88M (+21% YoY), Gross Margin 78.4%, Net Margin 24.8%, YoY Growth +21%
- Revenue & Margin Trend chart (monthly revenue and net income over 12 months)
- Monthly range: $267K (Jan) to $392K (Jun)
- DO NOT mention: providers, utilization, AR aging, cash balance, DSO

**[SHOW:pnl:margin] - P&L Panel with margin cards highlighted shows:**
- Same as above, with Gross Margin (78.4%) and Net Margin (24.8%) cards highlighted
- Use this when discussing margins specifically
- DO NOT mention: providers, utilization, AR aging, cash balance

**[SHOW:pnl:services] - P&L Panel + Service Breakdown shows:**
- All of the above PLUS Revenue by Service Line breakdown:
  - Injectables: $189K (64% margin)
  - Laser: $98K (71% margin)
  - Facials: $67K (68% margin)
  - Body: $54K (58% margin)
  - Retail: $34K (42% margin)
- DO NOT mention: providers, utilization, AR aging, cash balance

---
**[SHOW:cashflow] or [SHOW:cashflow:janfeb] - Cash Flow Panel shows:**
- 4 metric cards: Cash Balance $310K, DSO 38 days, Cash Conversion Cycle 42 days, Quick Ratio 2.1
- Cash Flow Trend chart showing Net Cash and Balance over 12 months
- Seasonal dip visible: Jan (-$42K), Feb (-$30K) negative cash months
- Balance dropped from $260K (Nov) to $185K (Mar)
- DO NOT mention: providers, utilization, service breakdown, gross/net margin percentages

**[SHOW:cashflow:conversion] - Cash Flow Panel with conversion metrics highlighted:**
- Same as above with DSO and Cash Conversion Cycle cards highlighted

---
**[SHOW:ar] or [SHOW:ar:aging] - AR Aging Panel shows:**
- 4 metric cards: Total AR $124K, Avg DSO 38 days, Over 60 Days 9%, Collection Rate 94%
- AR Aging Buckets bar chart:
  - Current: $67K (54%)
  - 1-30 days: $31K (25%)
  - 31-60 days: $15K (12%)
  - 61-90 days: $7.4K (6%)
  - 90+ days: $3.7K (3%)
- DO NOT mention: providers, utilization, service breakdown, monthly revenue trends

---
**[SHOW:providers] or [SHOW:providers:utilization] - Provider Panel shows:**
- Provider table with 5 rows showing: Name, Role, Revenue, Sessions, Avg Ticket, Utilization, Margin
- Dr. Sarah Chen (Medical Director): $156K, 312 sessions, $500 avg, 87% utilization, 62% margin
- Jessica Moore (NP): $134K, 402 sessions, $333 avg, 92% utilization, 58% margin
- Amanda Torres (Aesthetician): $89K, 534 sessions, $167 avg, 78% utilization, 71% margin
- Dr. Michael Park (PT MD): $67K, 134 sessions, $500 avg, 45% utilization, 54% margin - UNDERUTILIZED
- Rachel Kim (Aesthetician): $54K, 324 sessions, $167 avg, 65% utilization, 68% margin
- DO NOT mention: AR aging buckets, monthly cash flow, service breakdown

**[SHOW:providers:drpark] - Provider Panel with Dr. Park row highlighted:**
- Same as above with focus on Dr. Park's underutilization (45%)

---

**When to show each panel:**
- Cash problems → [SHOW:cashflow] or [SHOW:cashflow:janfeb]
- Profit/margin questions → [SHOW:pnl:margin]
- Service mix/breakdown → [SHOW:pnl:services]
- Collections/receivables → [SHOW:ar]
- Team/utilization/capacity → [SHOW:providers]

**Good examples (notice each ONLY mentions data visible on that panel):**

"Cash feeling tight during growth is super common. Here's a $3.88M med spa - look at January and February, they went negative (-$42K and -$30K) even though the business is healthy. That timing gap between revenue and collections is probably what you're feeling. [SHOW:cashflow:janfeb]"

"Good question on profitability. This business has 78.4% gross margin but 24.8% net margin - that 53-point gap is where all the operating costs live. The chart shows revenue and net income side by side so you can see the relationship. [SHOW:pnl:margin]"

"Collections show up fast in the aging buckets. This business has 9% sitting past 60 days - about $11K that might not come in. What does your aging look like? [SHOW:ar]"

"Team utilization is where hidden capacity lives. Look at Dr. Park - only 45% utilized versus Jessica at 92%. That's real revenue left on the table. [SHOW:providers]"

**NEVER reference data from a different panel than the one you're showing!**`;
  }

  private extractDataFromMessage(
    message: string,
    session: ChatSession
  ): {
    painPoints: string[];
    collectedData: Record<string, any>;
  } {
    const lowerMessage = message.toLowerCase();
    const painPoints: string[] = [];
    const collectedData: Record<string, any> = {};

    // Detect pain point categories
    if (lowerMessage.includes("cash") || lowerMessage.includes("tight") || lowerMessage.includes("runway")) {
      painPoints.push("CASH_FLOW");
    }
    if (lowerMessage.includes("profit") || lowerMessage.includes("margin") || lowerMessage.includes("losing money")) {
      painPoints.push("PROFITABILITY");
    }
    if (lowerMessage.includes("trust") || lowerMessage.includes("accurate") || lowerMessage.includes("books") || lowerMessage.includes("numbers")) {
      painPoints.push("TRUST_IN_NUMBERS");
    }
    if (lowerMessage.includes("receivable") || lowerMessage.includes("ar") || lowerMessage.includes("collect") || lowerMessage.includes("owed")) {
      painPoints.push("AR_COLLECTIONS");
    }
    if (lowerMessage.includes("expense") || lowerMessage.includes("cost") || lowerMessage.includes("spending")) {
      painPoints.push("EXPENSE_CONTROL");
    }
    if (lowerMessage.includes("hire") || lowerMessage.includes("grow") || lowerMessage.includes("expand") || lowerMessage.includes("invest")) {
      painPoints.push("GROWTH_DECISIONS");
    }

    // Extract revenue mentions
    const revenueMatch = message.match(/\$?([\d,]+)\s*(k|m|million|thousand)?/i);
    if (revenueMatch) {
      let amount = parseFloat(revenueMatch[1].replace(/,/g, ""));
      const multiplier = revenueMatch[2]?.toLowerCase();
      if (multiplier === "k" || multiplier === "thousand") amount *= 1000;
      if (multiplier === "m" || multiplier === "million") amount *= 1000000;

      if (amount >= 500000) {
        collectedData.estimatedRevenue = this.getRevenueBand(amount);
        collectedData.rawRevenue = amount;
      }
    }

    return { painPoints, collectedData };
  }

  private getRevenueBand(amount: number): string {
    if (amount < 500000) return "under-500k";
    if (amount < 1000000) return "500k-1m";
    if (amount < 3000000) return "1m-3m";
    if (amount < 10000000) return "3m-10m";
    if (amount < 25000000) return "10m-25m";
    if (amount < 50000000) return "25m-50m";
    return "over-50m";
  }

  private determineNextStage(
    session: ChatSession,
    extractedData: { painPoints: string[]; collectedData: Record<string, any> }
  ): ConversationStage {
    const currentStage = session.stage;
    const hasPainPoints = session.painPoints.length > 0 || extractedData.painPoints.length > 0;
    const hasRevenue = !!(session.collectedData as any)?.estimatedRevenue || !!extractedData.collectedData.estimatedRevenue;
    const messageCount = session.messageCount + 2;

    switch (currentStage) {
      case "GREETING":
        return hasPainPoints ? "PROBLEM_DISCOVERY" : "GREETING";

      case "PROBLEM_DISCOVERY":
        if (messageCount >= 4) return "PROBLEM_DEEP_DIVE";
        return "PROBLEM_DISCOVERY";

      case "PROBLEM_DEEP_DIVE":
        if (messageCount >= 6) {
          if (hasRevenue) return "STAKES_QUANTIFICATION";
          return "FRAMEWORK_EDUCATION";
        }
        return "PROBLEM_DEEP_DIVE";

      case "FRAMEWORK_EDUCATION":
        if (messageCount >= 8) return "BENCHMARKING";
        return "FRAMEWORK_EDUCATION";

      case "BENCHMARKING":
        if (messageCount >= 10 && hasRevenue) return "STAKES_QUANTIFICATION";
        return "BENCHMARKING";

      case "STAKES_QUANTIFICATION":
        if (messageCount >= 12) return "CTA_PRESENTATION";
        return "STAKES_QUANTIFICATION";

      case "CTA_PRESENTATION":
        return "FOLLOW_UP";

      case "FOLLOW_UP":
        return "FOLLOW_UP";

      default:
        return "PROBLEM_DISCOVERY";
    }
  }

  private shouldOfferCta(
    session: ChatSession,
    extractedData: { painPoints: string[]; collectedData: Record<string, any> }
  ): boolean {
    // Don't offer if already offered
    if (session.ctaOffered) return false;

    const hasPainPoints = session.painPoints.length > 0 || extractedData.painPoints.length > 0;
    const messageCount = session.messageCount + 2;
    const hasEngagement = messageCount >= 4; // Reduced from 6 to be more proactive

    // Offer CTA when we have pain points and sufficient engagement
    // More proactive - offer earlier in the conversation
    return hasPainPoints && hasEngagement && session.stage !== "GREETING";
  }

  private calculateEngagementScore(
    session: ChatSession,
    messageCount: number,
    extractedData: { painPoints: string[]; collectedData: Record<string, any> }
  ): number {
    let score = session.engagementScore;

    // +2 per message exchange, max 20
    score += Math.min(2, 20 - Math.min(score, 20));

    // +10 for returning visitor (already handled in startOrResumeSession)

    // +10 for specific pain point
    if (extractedData.painPoints.length > 0) {
      score += 10;
    }

    // +15 for revenue disclosure
    if (extractedData.collectedData.estimatedRevenue) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  private async updateLeadScore(
    leadId: string,
    engagementScore: number,
    painPoints: string[]
  ): Promise<void> {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    let newScore = engagementScore;
    let newStatus: LeadStatus = lead.status;

    // Adjust based on qualification signals
    if (painPoints.length >= 2) newScore += 5;
    if (painPoints.length >= 3) newScore += 10;

    // Update status based on score
    if (newScore >= 80) {
      newStatus = "QUALIFIED";
    } else if (newScore >= 50) {
      newStatus = "ENGAGED";
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        leadScore: newScore,
        status: newStatus,
        lastActivityAt: new Date(),
      },
    });
  }

  private getQuickPromptsForSession(session: ChatSessionWithMessages): string[] {
    return this.getQuickPromptsForStage(session.stage, session.painPoints);
  }

  private getQuickPromptsForStage(stage: ConversationStage, painPoints: string[]): string[] {
    if (stage === "GREETING" || painPoints.length === 0) {
      return INITIAL_QUICK_PROMPTS;
    }

    // Get prompts based on identified pain points
    const relevantPrompts: string[] = [];
    for (const painPoint of painPoints) {
      const prompts = CONTEXTUAL_QUICK_PROMPTS[painPoint as PainPointCategory];
      if (prompts) {
        relevantPrompts.push(...prompts);
      }
    }

    // Dedupe and limit to 3
    return [...new Set(relevantPrompts)].slice(0, 3);
  }

  /**
   * Parse [SHOW:panel] or [SHOW:panel:highlight] tags from AI response
   * Returns the cleaned message and any demo panel/highlight info
   */
  private parseDemoTags(message: string): {
    cleanMessage: string;
    demoPanel: DemoPanelType;
    demoHighlight: DemoHighlightType;
  } {
    // Match patterns like [SHOW:cashflow] or [SHOW:pnl:margin]
    const tagPattern = /\[SHOW:(\w+)(?::(\w+))?\]/g;

    let demoPanel: DemoPanelType = null;
    let demoHighlight: DemoHighlightType = null;

    // Find the last tag (in case there are multiple)
    let match;
    while ((match = tagPattern.exec(message)) !== null) {
      const panel = match[1] as DemoPanelType;
      const highlight = match[2] as DemoHighlightType || null;

      // Validate panel type
      if (['cashflow', 'pnl', 'ar', 'providers'].includes(panel)) {
        demoPanel = panel;
        demoHighlight = highlight;
      }
    }

    // Remove all [SHOW:*] tags from the message
    const cleanMessage = message.replace(tagPattern, '').trim();

    return { cleanMessage, demoPanel, demoHighlight };
  }
}

export const diagnosticChatService = new DiagnosticChatService();
