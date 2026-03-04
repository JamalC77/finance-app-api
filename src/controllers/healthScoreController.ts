import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { quickbooksAuthService } from '../services/quickbooks/quickbooksAuthService';
import { formatErrorResponse } from '../utils/errors';

/**
 * Maps backend HealthScoreStatus to a frontend step index (0-4)
 * for the processing screen progress indicator.
 */
function statusToStep(status: string): number {
  switch (status) {
    case 'PENDING':
    case 'CONNECTED':
      return 0; // Connecting to QuickBooks
    case 'PULLING_DATA':
      return 1; // Pulling financial data
    case 'CALCULATING':
      return 2; // Analyzing cash flow patterns
    case 'GENERATING_SUMMARY':
      return 3; // Calculating health metrics
    case 'SENDING_EMAIL':
      return 4; // Generating your report
    case 'COMPLETED':
      return 5; // Done
    case 'FAILED':
      return -1;
    default:
      return 0;
  }
}

class HealthScoreController {
  /**
   * POST /api/public/health-score/start
   *
   * Creates a new HealthScoreProspect and returns the QB OAuth URL.
   * Body: { email: string, source?: string, utmCampaign?: string, utmMedium?: string }
   */
  async start(req: Request, res: Response): Promise<void> {
    try {
      const { email, source, utmCampaign, utmMedium } = req.body;

      if (!email || typeof email !== 'string') {
        res.status(400).json(formatErrorResponse({
          statusCode: 400,
          message: 'Email is required',
        }));
        return;
      }

      // Basic email format check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json(formatErrorResponse({
          statusCode: 400,
          message: 'Invalid email format',
        }));
        return;
      }

      // Create prospect
      const prospect = await prisma.healthScoreProspect.create({
        data: {
          email: email.toLowerCase().trim(),
          source: source || null,
          utmCampaign: utmCampaign || null,
          utmMedium: utmMedium || null,
        },
      });

      console.log(`[HS Controller] Created prospect ${prospect.id} for ${prospect.email}`);

      // Generate QB OAuth URL
      const authUrl = quickbooksAuthService.getHealthScoreAuthUrl(prospect.id);

      res.json({
        prospectId: prospect.id,
        authUrl,
      });
    } catch (error) {
      console.error('[HS Controller] Error in start:', error);
      res.status(500).json(formatErrorResponse({
        statusCode: 500,
        message: 'Failed to start health score process',
      }));
    }
  }

  /**
   * GET /api/public/health-score/:id/status
   *
   * Returns the current processing status for a prospect.
   * Polled by the frontend every 3 seconds.
   */
  async status(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const prospect = await prisma.healthScoreProspect.findUnique({
        where: { id },
        select: {
          status: true,
          companyName: true,
          errorMessage: true,
        },
      });

      if (!prospect) {
        res.status(404).json(formatErrorResponse({
          statusCode: 404,
          message: 'Health score prospect not found',
        }));
        return;
      }

      const step = statusToStep(prospect.status);

      // If completed, include the score summary
      let compositeScore: number | undefined;
      let letterGrade: string | undefined;

      if (prospect.status === 'COMPLETED') {
        const score = await prisma.healthScore.findFirst({
          where: { prospectId: id },
          orderBy: { createdAt: 'desc' },
          select: { compositeScore: true, letterGrade: true },
        });
        if (score) {
          compositeScore = score.compositeScore;
          letterGrade = score.letterGrade;
        }
      }

      res.json({
        status: prospect.status,
        step,
        companyName: prospect.companyName || undefined,
        compositeScore,
        letterGrade,
        errorMessage: prospect.status === 'FAILED' ? prospect.errorMessage : undefined,
      });
    } catch (error) {
      console.error('[HS Controller] Error in status:', error);
      res.status(500).json(formatErrorResponse({
        statusCode: 500,
        message: 'Failed to get health score status',
      }));
    }
  }

  /**
   * GET /api/public/health-score/:id/result
   *
   * Returns the full score result. Only available when status is COMPLETED.
   */
  async result(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const prospect = await prisma.healthScoreProspect.findUnique({
        where: { id },
        select: { status: true, companyName: true },
      });

      if (!prospect) {
        res.status(404).json(formatErrorResponse({
          statusCode: 404,
          message: 'Health score prospect not found',
        }));
        return;
      }

      if (prospect.status !== 'COMPLETED') {
        res.status(400).json(formatErrorResponse({
          statusCode: 400,
          message: `Health score is not ready yet (status: ${prospect.status})`,
        }));
        return;
      }

      const score = await prisma.healthScore.findFirst({
        where: { prospectId: id },
        orderBy: { createdAt: 'desc' },
      });

      if (!score) {
        res.status(404).json(formatErrorResponse({
          statusCode: 404,
          message: 'Health score result not found',
        }));
        return;
      }

      res.json({
        compositeScore: score.compositeScore,
        letterGrade: score.letterGrade,
        runwayLabel: score.runwayLabel,
        liquidityScore: score.liquidityScore,
        receivablesScore: score.receivablesScore,
        revenueTrendScore: score.revenueTrendScore,
        profitabilityScore: score.profitabilityScore,
        cashRunwayScore: score.cashRunwayScore,
        summary: score.summary,
        cashProjection: score.cashProjection,
        companyName: prospect.companyName || 'Your Company',
        scoredAt: score.createdAt.toISOString(),
      });
    } catch (error) {
      console.error('[HS Controller] Error in result:', error);
      res.status(500).json(formatErrorResponse({
        statusCode: 500,
        message: 'Failed to get health score result',
      }));
    }
  }
}

export const healthScoreController = new HealthScoreController();
