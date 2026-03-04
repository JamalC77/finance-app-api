import { prisma } from '../../utils/prisma';
import { healthScoreDataService } from './healthScoreDataService';
import { calculateHealthScore } from './healthScoreCalculationEngine';
import { healthScoreLlmService } from './healthScoreLlmService';
import { healthScoreEmailService } from './healthScoreEmailService';
import type { HealthScoreEmailPayload } from '../../types/healthScore';

const CALENDLY_URL = process.env.CALENDLY_URL || 'https://calendly.com/thecfoline/diagnostic';

class HealthScoreOrchestrator {
  /**
   * Run the full health score pipeline for a prospect.
   * Called asynchronously after QB OAuth callback.
   *
   * Pipeline: PULLING_DATA → CALCULATING → GENERATING_SUMMARY → SENDING_EMAIL → COMPLETED
   */
  async processProspect(prospectId: string): Promise<void> {
    console.log(`[HS Orchestrator] Starting pipeline for prospect ${prospectId}`);

    try {
      // ---------------------------------------------------------------
      // 1. Pull QB data
      // ---------------------------------------------------------------
      await this.updateStatus(prospectId, 'PULLING_DATA');
      const rawData = await healthScoreDataService.pullData(prospectId);
      console.log(`[HS Orchestrator] Data pull complete for ${prospectId}`);

      // ---------------------------------------------------------------
      // 2. Calculate scores (deterministic, no I/O)
      // ---------------------------------------------------------------
      await this.updateStatus(prospectId, 'CALCULATING');
      const scoreResult = calculateHealthScore(rawData);
      console.log(
        `[HS Orchestrator] Score calculated: ${scoreResult.compositeScore} (${scoreResult.letterGrade}) for ${prospectId}`
      );

      // ---------------------------------------------------------------
      // 3. Generate LLM summary
      // ---------------------------------------------------------------
      await this.updateStatus(prospectId, 'GENERATING_SUMMARY');
      const companyName = rawData.companyName || 'Your Company';
      const summary = await healthScoreLlmService.generateSummary(companyName, scoreResult);
      console.log(`[HS Orchestrator] Summary generated for ${prospectId} (${summary.length} chars)`);

      // ---------------------------------------------------------------
      // 4. Persist score to DB
      // ---------------------------------------------------------------
      const prospect = await prisma.healthScoreProspect.findUnique({
        where: { id: prospectId },
      });

      const healthScore = await prisma.healthScore.create({
        data: {
          prospectId,
          compositeScore: scoreResult.compositeScore,
          letterGrade: scoreResult.letterGrade,
          runwayLabel: scoreResult.runwayLabel,
          liquidityScore: scoreResult.liquidityScore.score,
          receivablesScore: scoreResult.receivablesScore.score,
          revenueTrendScore: scoreResult.revenueTrendScore.score,
          profitabilityScore: scoreResult.profitabilityScore.score,
          cashRunwayScore: scoreResult.cashRunwayScore.score,
          metricsSnapshot: scoreResult.metricsSnapshot as any,
          summary,
          cashProjection: scoreResult.cashProjection as any,
        },
      });
      console.log(`[HS Orchestrator] Score persisted: ${healthScore.id}`);

      // ---------------------------------------------------------------
      // 5. Send email
      // ---------------------------------------------------------------
      await this.updateStatus(prospectId, 'SENDING_EMAIL');
      const emailPayload: HealthScoreEmailPayload = {
        companyName,
        email: prospect!.email,
        compositeScore: scoreResult.compositeScore,
        letterGrade: scoreResult.letterGrade,
        runwayLabel: scoreResult.runwayLabel,
        liquidityScore: scoreResult.liquidityScore.score,
        receivablesScore: scoreResult.receivablesScore.score,
        revenueTrendScore: scoreResult.revenueTrendScore.score,
        profitabilityScore: scoreResult.profitabilityScore.score,
        cashRunwayScore: scoreResult.cashRunwayScore.score,
        summary,
        cashProjection: scoreResult.cashProjection,
        metricsSnapshot: scoreResult.metricsSnapshot,
        calendlyUrl: CALENDLY_URL,
      };

      const emailResult = await healthScoreEmailService.sendScoreEmail(emailPayload);

      if (emailResult) {
        await prisma.healthScore.update({
          where: { id: healthScore.id },
          data: {
            emailSentAt: new Date(),
            emailId: emailResult.emailId,
          },
        });
        console.log(`[HS Orchestrator] Email sent for ${prospectId}: ${emailResult.emailId}`);
      } else {
        console.error(`[HS Orchestrator] Email send failed for ${prospectId} (all retries exhausted)`);
      }

      // ---------------------------------------------------------------
      // 6. Mark complete + clean up tokens
      // ---------------------------------------------------------------
      await prisma.healthScoreProspect.update({
        where: { id: prospectId },
        data: {
          status: 'COMPLETED',
          companyName,
          // Clear tokens — we no longer need QB access
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
        },
      });

      console.log(`[HS Orchestrator] Pipeline COMPLETED for ${prospectId}`);
    } catch (error) {
      console.error(`[HS Orchestrator] Pipeline FAILED for ${prospectId}:`, error);

      await prisma.healthScoreProspect.update({
        where: { id: prospectId },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          // Clear tokens on failure too
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
        },
      });
    }
  }

  /**
   * Update the prospect status in the database.
   */
  private async updateStatus(
    prospectId: string,
    status: 'PULLING_DATA' | 'CALCULATING' | 'GENERATING_SUMMARY' | 'SENDING_EMAIL'
  ): Promise<void> {
    await prisma.healthScoreProspect.update({
      where: { id: prospectId },
      data: { status },
    });
  }
}

export const healthScoreOrchestrator = new HealthScoreOrchestrator();
