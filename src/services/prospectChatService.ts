import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { prisma } from "../utils/prisma";
import { ConversationStage, ProspectChatSession, ProspectChatMessage } from "@prisma/client";

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

// Types for prospect configuration (loaded from JSON files)
interface PainPoint {
  id: string;
  title: string;
  summary?: string;
  opener: string;
  question: string;
  options: string[];
}

interface BotContext {
  systemPromptAdditions: string;
  knownFacts: string[];
}

interface CTAConfig {
  headline: string;
  subhead: string;
  buttonText: string;
  calendarLink: string;
}

interface ProspectConfig {
  slug: string;
  companyName: string;
  ownerName: string;
  location?: string;
  industry?: string;
  estimatedRevenue?: string;
  employeeCount?: number;
  painPoints: PainPoint[];
  botContext: BotContext;
  cta: CTAConfig;
}

interface ProspectChatSessionWithMessages extends ProspectChatSession {
  messages: ProspectChatMessage[];
}

interface SendMessageResult {
  response: string;
  quickPrompts: string[];
  stage: ConversationStage;
  ctaOffered: boolean;
}

// Load prospect configuration from JSON files
function loadProspectConfig(slug: string): ProspectConfig | null {
  // In production: look in local content directory
  // In development: also check sibling frontend directory as fallback
  const localDir = path.resolve(process.cwd(), "content/prospects");
  const siblingDir = path.resolve(process.cwd(), "../finance-app/content/prospects");

  let filePath = path.join(localDir, `${slug}.json`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(siblingDir, `${slug}.json`);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Prospect config not found in ${localDir} or ${siblingDir}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as ProspectConfig;
  } catch (error) {
    console.error(`Error loading prospect config for ${slug}:`, error);
    return null;
  }
}

class ProspectChatService {
  /**
   * Start a new prospect chat session
   */
  async startSession(params: {
    sessionId: string;
    prospectSlug: string;
    utmSource?: string;
    utmCampaign?: string;
    utmMedium?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    sessionId: string;
    messages: Array<{ role: string; content: string; timestamp: Date }>;
    quickPrompts: string[];
    prospect: { companyName: string; ownerName: string };
  }> {
    const { sessionId, prospectSlug, utmSource, utmCampaign, utmMedium, ipAddress, userAgent } = params;

    // Load prospect config
    const prospect = loadProspectConfig(prospectSlug);
    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectSlug}`);
    }

    // Check for existing session
    let session = await prisma.prospectChatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (session) {
      // Returning to existing session
      await prisma.prospectChatSession.update({
        where: { id: session.id },
        data: { lastMessageAt: new Date() },
      });

      return {
        sessionId: session.sessionId,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.createdAt,
        })),
        quickPrompts: this.getQuickPromptsForSession(prospect, session),
        prospect: { companyName: prospect.companyName, ownerName: prospect.ownerName },
      };
    }

    // Generate personalized greeting using first pain point
    const greeting = this.generateProspectGreeting(prospect);

    // Create new session
    session = await prisma.prospectChatSession.create({
      data: {
        sessionId,
        prospectSlug,
        stage: "GREETING",
        utmSource,
        utmCampaign,
        utmMedium,
        ipAddress,
        userAgent,
        messages: {
          create: {
            role: "assistant",
            content: greeting,
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
      quickPrompts: this.getQuickPromptsForSession(prospect, session),
      prospect: { companyName: prospect.companyName, ownerName: prospect.ownerName },
    };
  }

  /**
   * Send a message in an existing prospect chat session
   */
  async sendMessage(sessionId: string, message: string): Promise<SendMessageResult> {
    // Get session with messages
    const session = await prisma.prospectChatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Load prospect config
    const prospect = loadProspectConfig(session.prospectSlug);
    if (!prospect) {
      throw new Error(`Prospect not found: ${session.prospectSlug}`);
    }

    // Save user message
    await prisma.prospectChatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: message,
      },
    });

    // Extract data from user message
    const extractedData = this.extractDataFromMessage(message, session);

    // Determine next conversation stage
    const nextStage = this.determineNextStage(session, extractedData);

    // Determine if we should offer CTA
    const shouldOfferCta = this.shouldOfferCta(session, nextStage);

    // Build system prompt with prospect context
    const systemPrompt = this.buildProspectSystemPrompt(prospect, session, nextStage, shouldOfferCta);

    // Build conversation history for API
    const conversationHistory = session.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    conversationHistory.push({ role: "user", content: message });

    // Get AI response
    const anthropic = getAnthropicClient();
    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: systemPrompt,
      messages: conversationHistory,
    });

    const responseText = aiResponse.content[0].type === "text" ? aiResponse.content[0].text : "";

    // Save assistant message
    await prisma.prospectChatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: responseText,
        tokenCount: aiResponse.usage?.output_tokens,
      },
    });

    // Update session
    const mergedPainPoints = [...new Set([...session.painPoints, ...extractedData.painPoints])];
    const mergedData = { ...(session.collectedData as Record<string, unknown> || {}), ...extractedData.collectedData };
    const newEngagementScore = this.calculateEngagementScore(session, extractedData);

    await prisma.prospectChatSession.update({
      where: { id: session.id },
      data: {
        stage: nextStage,
        painPoints: mergedPainPoints,
        collectedData: JSON.parse(JSON.stringify(mergedData)),
        engagementScore: newEngagementScore,
        messageCount: { increment: 2 },
        ctaOffered: shouldOfferCta || session.ctaOffered,
        lastMessageAt: new Date(),
      },
    });

    return {
      response: responseText,
      quickPrompts: this.getQuickPromptsForStage(prospect, nextStage, mergedPainPoints),
      stage: nextStage,
      ctaOffered: shouldOfferCta || session.ctaOffered,
    };
  }

  /**
   * Track CTA click
   */
  async trackCtaClick(sessionId: string): Promise<void> {
    await prisma.prospectChatSession.updateMany({
      where: { sessionId },
      data: { ctaClicked: true },
    });
  }

  // ==========================================
  // Private helper methods
  // ==========================================

  private generateProspectGreeting(prospect: ProspectConfig): string {
    // Use the first pain point opener and question
    const firstPainPoint = prospect.painPoints[0];
    if (firstPainPoint) {
      return `${firstPainPoint.opener}\n\n${firstPainPoint.question}`;
    }

    // Fallback generic greeting (handle empty owner name)
    const greeting = prospect.ownerName
      ? `Hi ${prospect.ownerName}, I've been looking into ${prospect.companyName}.`
      : `I've been looking into ${prospect.companyName}.`;
    return `${greeting} What's the biggest financial challenge on your mind right now?`;
  }

  private getQuickPromptsForSession(
    prospect: ProspectConfig,
    session: ProspectChatSession
  ): string[] {
    return this.getQuickPromptsForStage(prospect, session.stage, session.painPoints);
  }

  private getQuickPromptsForStage(
    prospect: ProspectConfig,
    stage: ConversationStage,
    _exploredPainPoints: string[]
  ): string[] {
    // Use pain point options as quick prompts
    const currentPainPoint = prospect.painPoints[0]; // Start with first
    if (currentPainPoint && stage === "GREETING") {
      return currentPainPoint.options.slice(0, 4);
    }

    // Later stages - offer other pain point topics or general prompts
    if (stage === "PROBLEM_DISCOVERY" || stage === "PROBLEM_DEEP_DIVE") {
      const otherPainPoints = prospect.painPoints.slice(1);
      if (otherPainPoints.length > 0) {
        return otherPainPoints.map((pp) => pp.title).slice(0, 3);
      }
    }

    // Default prompts for later stages
    return [
      "Tell me more about your services",
      "What's a Financial Diagnostic?",
      "I'd like to book a call",
    ];
  }

  private buildProspectSystemPrompt(
    prospect: ProspectConfig,
    session: ProspectChatSessionWithMessages | ProspectChatSession,
    stage: ConversationStage,
    shouldOfferCta: boolean
  ): string {
    const calendlyUrl = prospect.cta.calendarLink || process.env.CALENDLY_URL || "https://calendly.com/cfoline";

    return `You are a diagnostic financial advisor for The CFO Line, having a personalized conversation with a prospect whose business we've already researched.

## About This Prospect
Company: ${prospect.companyName}
${prospect.ownerName ? `Contact: ${prospect.ownerName}` : "Contact: Unknown - could be owner, manager, or staff"}
${prospect.location ? `Location: ${prospect.location}` : ""}
${prospect.industry ? `Industry: ${prospect.industry}` : ""}
${prospect.estimatedRevenue ? `Estimated Revenue: ${prospect.estimatedRevenue}` : ""}
${prospect.employeeCount ? `Employee Count: ~${prospect.employeeCount}` : ""}

## What We Know About Their Business
${prospect.botContext.knownFacts.map((fact) => `- ${fact}`).join("\n")}

## Custom Context
${prospect.botContext.systemPromptAdditions}

## Pain Points We've Identified (use naturally in conversation)
${prospect.painPoints.map((pp) => `- **${pp.title}**: ${pp.summary || pp.opener}`).join("\n")}

## Your Role
You're not selling - you're diagnosing. You've already done research on this business. Reference specific things you know about them naturally. Help them understand their financial situation clearly. The goal is to surface pain points and demonstrate that you understand their business.

## What We Offer (for context, not to pitch unprompted)
The CFO Line provides fractional finance leadership:
- **Books** ($2,500/mo) - Monthly bookkeeping, reconciliations, close-ready books
- **Close** ($4,750/mo) - Owns month-end close, reporting pack, variance analysis
- **Strategy** ($7,000/mo) - Cash forecasting, scenario modeling, board prep

**Financial Diagnostic** ($2,500) - Entry point that delivers a one-page CFO Brief with cash analysis, priority fixes, and recommended approach. Credited toward first month.

## Conversation Approach
1. Reference specific facts about their business naturally
2. Ask ONE diagnostic question at a time
3. Listen for pain indicators and dig deeper
4. Quantify stakes when you have enough information
5. When they're engaged, suggest booking a call

## Current Conversation Context
Stage: ${stage}
Pain Points Discussed: ${session.painPoints.join(", ") || "None yet"}
Message Count: ${session.messageCount}

## Booking a Call
When someone expresses interest or has engaged meaningfully with their problems, suggest booking a call:

"Want to dig into this together? You can grab 30 minutes here: ${calendlyUrl}"

${shouldOfferCta ? `
## CTA Instruction
The conversation has reached a natural point to suggest next steps. Offer to book a call:
"It sounds like there's real opportunity here. Want to spend 30 minutes walking through your specific situation? You can book directly: ${calendlyUrl}"
` : ""}

## Response Style
- Conversational, not corporate
- Concise (2-4 sentences typical)
- Reference their specific business details naturally
- Ask follow-up questions
- Use "you/your" not "one/one's"
- Match their energy

## What You Should NOT Do
- Don't dump all the intel at once - reveal it naturally
- Don't be salesy or pushy
- Don't write long responses
- Don't pretend to have answers you don't have
- Don't mention that you "researched" them - just naturally know things`;
  }

  private extractDataFromMessage(
    message: string,
    _session: ProspectChatSession
  ): {
    painPoints: string[];
    collectedData: Record<string, unknown>;
  } {
    const lowerMessage = message.toLowerCase();
    const painPoints: string[] = [];
    const collectedData: Record<string, unknown> = {};

    // Detect pain point categories
    if (lowerMessage.includes("cash") || lowerMessage.includes("tight") || lowerMessage.includes("runway")) {
      painPoints.push("CASH_FLOW");
    }
    if (lowerMessage.includes("profit") || lowerMessage.includes("margin") || lowerMessage.includes("losing")) {
      painPoints.push("PROFITABILITY");
    }
    if (lowerMessage.includes("track") || lowerMessage.includes("reconcil") || lowerMessage.includes("platform")) {
      painPoints.push("OPERATIONS");
    }
    if (lowerMessage.includes("hire") || lowerMessage.includes("grow") || lowerMessage.includes("scale")) {
      painPoints.push("GROWTH");
    }
    if (lowerMessage.includes("myself") || lowerMessage.includes("mess") || lowerMessage.includes("accountant")) {
      painPoints.push("INFRASTRUCTURE");
    }

    return { painPoints, collectedData };
  }

  private determineNextStage(
    session: ProspectChatSession,
    extractedData: { painPoints: string[]; collectedData: Record<string, unknown> }
  ): ConversationStage {
    const currentStage = session.stage;
    const hasPainPoints = session.painPoints.length > 0 || extractedData.painPoints.length > 0;
    const messageCount = session.messageCount + 2;

    switch (currentStage) {
      case "GREETING":
        return hasPainPoints ? "PROBLEM_DISCOVERY" : "GREETING";

      case "PROBLEM_DISCOVERY":
        if (messageCount >= 4) return "PROBLEM_DEEP_DIVE";
        return "PROBLEM_DISCOVERY";

      case "PROBLEM_DEEP_DIVE":
        if (messageCount >= 6) return "STAKES_QUANTIFICATION";
        return "PROBLEM_DEEP_DIVE";

      case "STAKES_QUANTIFICATION":
        if (messageCount >= 8) return "CTA_PRESENTATION";
        return "STAKES_QUANTIFICATION";

      case "CTA_PRESENTATION":
        return "FOLLOW_UP";

      default:
        return currentStage;
    }
  }

  private shouldOfferCta(session: ProspectChatSession, nextStage: ConversationStage): boolean {
    // Already offered
    if (session.ctaOffered) return false;

    // Offer CTA at appropriate stage
    if (nextStage === "CTA_PRESENTATION" || nextStage === "FOLLOW_UP") {
      return true;
    }

    // Or if engagement is high enough
    if (session.engagementScore >= 40 && session.messageCount >= 4) {
      return true;
    }

    return false;
  }

  private calculateEngagementScore(
    session: ProspectChatSession,
    extractedData: { painPoints: string[]; collectedData: Record<string, unknown> }
  ): number {
    let score = session.engagementScore;

    // Points for pain points identified
    score += extractedData.painPoints.length * 10;

    // Points for message exchanges
    score += 5;

    // Cap at 100
    return Math.min(score, 100);
  }
}

export const prospectChatService = new ProspectChatService();
