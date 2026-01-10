import express, { Request, Response, NextFunction } from "express";
import { aiCfoController } from "../controllers/aiCfoController";
import { auth } from "../middleware/authMiddleware";
import { ApiError } from "../utils/errors";

const router = express.Router();

// All routes require authentication
router.use(auth);

/**
 * POST /api/ai-cfo/ask
 * Ask the AI CFO a question about your finances
 */
router.post("/ask", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ApiError(401, "Organization not found");
    }

    const { question, conversationHistory } = req.body;

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      throw new ApiError(400, "Question is required");
    }

    if (question.length > 2000) {
      throw new ApiError(400, "Question is too long (max 2000 characters)");
    }

    const result = await aiCfoController.askQuestion({
      organizationId,
      question: question.trim(),
      conversationHistory: conversationHistory || [],
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai-cfo/weekly-summary
 * Generate a weekly executive summary
 */
router.get("/weekly-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ApiError(401, "Organization not found");
    }

    const result = await aiCfoController.generateWeeklySummary(organizationId);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ai-cfo/analyze-hire
 * Analyze a potential hiring decision
 */
router.post("/analyze-hire", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ApiError(401, "Organization not found");
    }

    const { role, salary, count, startMonth } = req.body;

    if (!role || typeof role !== "string") {
      throw new ApiError(400, "Role is required");
    }

    if (!salary || typeof salary !== "number" || salary <= 0) {
      throw new ApiError(400, "Valid salary is required");
    }

    if (!count || typeof count !== "number" || count <= 0) {
      throw new ApiError(400, "Valid count is required");
    }

    const result = await aiCfoController.analyzeHiringDecision(organizationId, {
      role,
      salary,
      count,
      startMonth,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/ai-cfo/collection-priorities
 * Get prioritized collection recommendations
 */
router.get("/collection-priorities", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ApiError(401, "Organization not found");
    }

    const result = await aiCfoController.getCollectionPriorities(organizationId);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
