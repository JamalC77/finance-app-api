import { Request, Response } from "express";
import { prospectChatService } from "../services/prospectChatService";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../utils/prisma";
import path from "path";
import fs from "fs";

// Load prospect configuration from JSON files (for public data endpoint)
function loadProspectPublicData(slug: string) {
  // In production: look in local content directory
  // In development: also check sibling frontend directory as fallback
  const localDir = path.resolve(process.cwd(), "content/prospects");
  const siblingDir = path.resolve(process.cwd(), "../finance-app/content/prospects");

  let filePath = path.join(localDir, `${slug}.json`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(siblingDir, `${slug}.json`);
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);

    // Return public data only (strip bot context and openers)
    return {
      slug: data.slug,
      companyName: data.companyName,
      ownerName: data.ownerName,
      location: data.location,
      industry: data.industry,
      estimatedRevenue: data.estimatedRevenue,
      employeeCount: data.employeeCount,
      intelCards: data.intelCards,
      painPoints: data.painPoints.map((pp: { id: string; title: string; question: string; options: string[] }) => ({
        id: pp.id,
        title: pp.title,
        question: pp.question,
        options: pp.options,
      })),
      cta: data.cta,
    };
  } catch (error) {
    console.error(`Error loading prospect config for ${slug}:`, error);
    return null;
  }
}

/**
 * Get prospect page data (public info only)
 * GET /api/public/prospect/:slug
 */
export const getProspectPageData = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;

  if (!slug) {
    return res.status(400).json({ error: "Prospect slug is required" });
  }

  const prospectData = loadProspectPublicData(slug);

  if (!prospectData) {
    return res.status(404).json({ error: "Prospect not found" });
  }

  return res.json(prospectData);
});

/**
 * Track page view
 * POST /api/public/prospect/:slug/view
 */
export const trackPageView = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { visitorId, utmSource, utmCampaign, utmMedium } = req.body;

  if (!slug) {
    return res.status(400).json({ error: "Prospect slug is required" });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];
  const referrer = req.headers["referer"] || req.headers["referrer"];

  await prisma.prospectPageView.create({
    data: {
      prospectSlug: slug,
      visitorId,
      ipAddress,
      userAgent,
      referrer: referrer as string | undefined,
      utmSource,
      utmCampaign,
      utmMedium,
    },
  });

  return res.json({ success: true });
});

/**
 * Start a prospect chat session
 * POST /api/public/prospect/:slug/chat/start
 */
export const startProspectChat = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { sessionId, utmSource, utmCampaign, utmMedium } = req.body;

  if (!slug) {
    return res.status(400).json({ error: "Prospect slug is required" });
  }

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  try {
    const result = await prospectChatService.startSession({
      sessionId,
      prospectSlug: slug,
      utmSource,
      utmCampaign,
      utmMedium,
      ipAddress,
      userAgent,
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
});

/**
 * Send a message in a prospect chat session
 * POST /api/public/prospect/:slug/chat/message
 */
export const sendProspectMessage = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, message } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message is required" });
  }

  // Limit message length
  const trimmedMessage = message.trim().slice(0, 2000);

  const result = await prospectChatService.sendMessage(sessionId, trimmedMessage);

  return res.json(result);
});

/**
 * Track CTA click
 * POST /api/public/prospect/:slug/cta-click
 */
export const trackCtaClick = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { sessionId, pageViewId } = req.body;

  if (!slug) {
    return res.status(400).json({ error: "Prospect slug is required" });
  }

  // Update chat session if provided
  if (sessionId) {
    await prospectChatService.trackCtaClick(sessionId);
  }

  // Update page view if provided
  if (pageViewId) {
    await prisma.prospectPageView.update({
      where: { id: pageViewId },
      data: { ctaClicked: true },
    });
  }

  return res.json({ success: true });
});
