import { Resend } from 'resend';
import type { HealthScoreEmailPayload } from '../../types/healthScore';

class HealthScoreEmailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  /**
   * Send the Financial Health Score report email.
   * Retries up to 3 times with exponential backoff (1s, 3s, 9s).
   * Returns the email ID on success, or null on failure.
   */
  async sendScoreEmail(
    payload: HealthScoreEmailPayload
  ): Promise<{ emailId: string } | null> {
    const html = this.buildEmailHtml(payload);
    const fromAddress = process.env.EMAIL_FROM || 'reports@thecfoline.com';
    const subject = `Your Financial Health Score: ${payload.compositeScore}/100 (${payload.letterGrade}) — ${payload.companyName}`;

    const delays = [1000, 3000, 9000];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await this.resend.emails.send({
          from: `The CFO Line <${fromAddress}>`,
          to: payload.email,
          subject,
          replyTo: 'brent@thecfoline.com',
          html,
        });

        if (error) {
          console.error(
            `[HealthScoreEmailService] Resend API error (attempt ${attempt + 1}/3):`,
            error
          );
          if (attempt < 2) {
            await this.sleep(delays[attempt]);
            continue;
          }
          return null;
        }

        console.log(
          `[HealthScoreEmailService] Email sent successfully to ${payload.email}, id: ${data?.id}`
        );
        return { emailId: data?.id ?? '' };
      } catch (err) {
        console.error(
          `[HealthScoreEmailService] Exception sending email (attempt ${attempt + 1}/3):`,
          err
        );
        if (attempt < 2) {
          await this.sleep(delays[attempt]);
          continue;
        }
        return null;
      }
    }

    return null;
  }

  /**
   * Build the full HTML email for the Financial Health Score report.
   */
  private buildEmailHtml(payload: HealthScoreEmailPayload): string {
    const {
      companyName,
      compositeScore,
      letterGrade,
      runwayLabel,
      liquidityScore,
      receivablesScore,
      revenueTrendScore,
      profitabilityScore,
      cashRunwayScore,
      summary,
      cashProjection,
      calendlyUrl,
    } = payload;

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // --- Runway section ---
    const runwayColor =
      runwayLabel === 'Good'
        ? '#22c55e'
        : runwayLabel === 'Needs Attention'
          ? '#eab308'
          : '#ef4444';

    const runwayDescription =
      runwayLabel === 'Good'
        ? 'Your cash position can support operations for 6+ months based on current trends. This gives you a stable foundation to invest in growth or absorb unexpected expenses.'
        : runwayLabel === 'Needs Attention'
          ? 'Your current cash trajectory suggests 2-6 months of operating runway. This is manageable but leaves limited margin for surprises. Tightening collections or trimming discretionary spend could strengthen your position.'
          : 'At current rate, your operating runway is under 2 months. Immediate attention to cash inflows and outflows is critical to avoid a liquidity crisis.';

    // --- Category bars ---
    const categories = [
      { name: 'Liquidity', score: liquidityScore },
      { name: 'Receivables', score: receivablesScore },
      { name: 'Revenue Trend', score: revenueTrendScore },
      { name: 'Profitability', score: profitabilityScore },
      { name: 'Cash Runway', score: cashRunwayScore },
    ];

    const categoryRows = categories
      .map((cat) => {
        const color = this.scoreColor(cat.score);
        const barWidth = Math.max(cat.score, 2); // minimum visible width
        return `
        <tr>
          <td style="padding: 10px 0; color: #e4e4e7; font-size: 14px; width: 140px; vertical-align: middle;">
            ${cat.name}
          </td>
          <td style="padding: 10px 0; vertical-align: middle;">
            <div style="display: inline-block; width: ${barWidth}%; max-width: 200px; height: 20px; background-color: ${color}; border-radius: 4px;"></div>
            <span style="color: #e4e4e7; font-size: 14px; margin-left: 8px; vertical-align: middle;">${cat.score}</span>
          </td>
        </tr>`;
      })
      .join('');

    // --- Cash projection rows ---
    const projectionRows = [
      { label: '30 Days', amount: cashProjection.projected30d },
      { label: '60 Days', amount: cashProjection.projected60d },
      { label: '90 Days', amount: cashProjection.projected90d },
    ]
      .map(
        (row) => `
        <tr>
          <td style="padding: 8px 16px; color: #e4e4e7; font-size: 14px; border-bottom: 1px solid #1e1e2e;">
            ${row.label}
          </td>
          <td style="padding: 8px 16px; color: #e4e4e7; font-size: 14px; text-align: right; border-bottom: 1px solid #1e1e2e;">
            ${this.formatDollars(row.amount)}
          </td>
        </tr>`
      )
      .join('');

    // --- Summary paragraphs ---
    const summaryParagraphs = summary
      .split('\n\n')
      .filter((p) => p.trim())
      .map(
        (p) =>
          `<p style="color: #e4e4e7; font-size: 14px; line-height: 1.65; margin: 0 0 14px 0;">${p.trim()}</p>`
      )
      .join('');

    // --- Grade color ---
    const gradeColor = compositeScore >= 70 ? '#22c55e' : compositeScore >= 40 ? '#eab308' : '#ef4444';

    // --- Full HTML ---
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Financial Health Report</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 24px 0 8px 0;">
              <span style="font-size: 13px; letter-spacing: 4px; color: #d4a843; font-variant: small-caps; font-weight: 600;">THE CFO LINE</span>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding: 8px 0 4px 0;">
              <h1 style="margin: 0; font-size: 20px; letter-spacing: 2px; color: #e4e4e7; font-weight: 600;">FINANCIAL HEALTH REPORT</h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 4px 0 24px 0;">
              <span style="font-size: 14px; color: #71717a;">${companyName} &mdash; ${dateStr}</span>
            </td>
          </tr>

          <!-- Score Card -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 32px 24px;">
                    <div style="font-size: 56px; font-weight: 700; color: ${gradeColor}; line-height: 1;">${compositeScore}</div>
                    <div style="font-size: 14px; color: #71717a; margin-top: 4px;">out of 100</div>
                    <div style="margin-top: 12px; display: inline-block; padding: 4px 16px; border: 2px solid ${gradeColor}; border-radius: 6px;">
                      <span style="font-size: 22px; font-weight: 700; color: ${gradeColor}; letter-spacing: 2px;">${letterGrade}</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Runway -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <div style="font-size: 11px; letter-spacing: 2px; color: #71717a; text-transform: uppercase; margin-bottom: 12px;">Cash Runway</div>
                    <div style="font-size: 20px; font-weight: 700; color: ${runwayColor}; margin-bottom: 12px;">${runwayLabel}</div>
                    <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0;">${runwayDescription}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Category Breakdown -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <div style="font-size: 11px; letter-spacing: 2px; color: #71717a; text-transform: uppercase; margin-bottom: 16px;">Category Breakdown</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${categoryRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <div style="font-size: 11px; letter-spacing: 2px; color: #71717a; text-transform: uppercase; margin-bottom: 16px;">What This Means</div>
                    ${summaryParagraphs}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Cash Projection -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <div style="font-size: 11px; letter-spacing: 2px; color: #71717a; text-transform: uppercase; margin-bottom: 16px;">90-Day Cash Projection</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 8px 16px; color: #71717a; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Period</td>
                        <td style="padding: 8px 16px; color: #71717a; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; text-align: right;">Projected Cash</td>
                      </tr>
                      ${projectionRows}
                    </table>
                    <p style="color: #71717a; font-size: 12px; font-style: italic; margin: 14px 0 0 0;">Directional estimate based on recent trends, not a guarantee.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 0 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #111118; border: 1px solid #1e1e2e; border-radius: 8px;">
                <tr>
                  <td align="center" style="padding: 32px 24px;">
                    <div style="font-size: 16px; font-weight: 700; color: #e4e4e7; letter-spacing: 1px; margin-bottom: 12px;">WANT TO KNOW EXACTLY WHERE THE MONEY IS GOING?</div>
                    <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                      A 30-minute diagnostic call with our team will break down your numbers, pinpoint the biggest levers for improvement, and give you a clear action plan.
                    </p>
                    <a href="${calendlyUrl}" target="_blank" style="display: inline-block; background-color: #d4a843; color: #111118; font-size: 14px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 6px; letter-spacing: 1px;">SCHEDULE A DIAGNOSTIC CALL &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 16px 8px 16px;">
              <span style="font-size: 13px; color: #71717a; font-weight: 600;">The CFO Line</span>
              <span style="font-size: 13px; color: #71717a;"> &mdash; Financial Intelligence for Growing Businesses</span>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 16px;">
              <p style="font-size: 11px; color: #52525b; line-height: 1.5; margin: 0;">
                This report is generated from your QuickBooks data and is intended for informational purposes only. It does not constitute financial advice. Consult a licensed professional before making financial decisions.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 16px 32px 16px;">
              <p style="font-size: 11px; color: #52525b; line-height: 1.5; margin: 0;">
                Your financial data was accessed securely via QuickBooks OAuth and was not stored after scoring. For questions about data handling, contact us at brent@thecfoline.com.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  }

  /**
   * Format a number as dollars: $1,234 (no decimals, with commas).
   */
  private formatDollars(amount: number): string {
    return `$${Math.round(amount).toLocaleString()}`;
  }

  /**
   * Return a hex color based on score thresholds.
   * Green (>70), Amber (40-70), Red (<40).
   */
  private scoreColor(score: number): string {
    if (score > 70) return '#22c55e';
    if (score >= 40) return '#eab308';
    return '#ef4444';
  }

  /**
   * Promise-based sleep utility for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const healthScoreEmailService = new HealthScoreEmailService();
