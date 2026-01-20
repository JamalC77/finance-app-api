import { Request, Response } from "express";
import { diagnosticChatService } from "../services/diagnosticChatService";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Start a new chat session or resume an existing one
 * POST /api/public/chat/start
 */
export const startSession = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, source, utmCampaign, utmMedium } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await diagnosticChatService.startOrResumeSession({
    sessionId,
    source,
    utmCampaign,
    utmMedium,
    ipAddress,
    userAgent,
  });

  return res.json(result);
});

/**
 * Send a message in an existing chat session
 * POST /api/public/chat/message
 */
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, message } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message is required" });
  }

  // Limit message length
  const trimmedMessage = message.trim().slice(0, 2000);

  const result = await diagnosticChatService.sendMessage(sessionId, trimmedMessage);

  return res.json(result);
});

/**
 * Track when a user clicks the Calendly booking link
 * POST /api/public/chat/calendly-clicked
 */
export const trackCalendlyClick = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  await diagnosticChatService.trackCalendlyClick(sessionId);

  return res.json({ success: true });
});

/**
 * Get the Calendly booking URL
 * GET /api/public/chat/calendly-url
 */
export const getCalendlyUrl = asyncHandler(async (req: Request, res: Response) => {
  // Return the Calendly URL from environment or default
  const calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/cfoline";

  return res.json({ url: calendlyUrl });
});

/**
 * Capture lead information (email, name, company)
 * POST /api/public/chat/capture-lead
 */
export const captureLeadInfo = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, email, name, companyName, phoneNumber } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  // Basic email validation if provided
  if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  await diagnosticChatService.captureLeadInfo(sessionId, {
    email,
    name,
    companyName,
    phoneNumber,
  });

  return res.json({ success: true });
});
