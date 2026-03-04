import type {
  HealthScoreRawData,
  HealthScoreResult,
  CategoryScoreResult,
  MetricsSnapshot,
  CashProjection,
} from '../../types/healthScore';

// ==========================================
// Helpers
// ==========================================

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation: maps `value` within [min, max] to [scoreMin, scoreMax] */
function interpolate(
  value: number,
  min: number,
  max: number,
  scoreMin: number,
  scoreMax: number,
): number {
  if (max === min) return scoreMin;
  const t = (value - min) / (max - min);
  return scoreMin + clamp(t, 0, 1) * (scoreMax - scoreMin);
}

/**
 * Simple linear regression on y-values indexed 0..n-1.
 * Returns slope of the regression line.
 */
function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/** Safe division: returns fallback when divisor is 0 or non-finite */
function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  if (denominator === 0 || !isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return isFinite(result) ? result : fallback;
}

/** Build a "limited data" category result */
function limitedDataResult(category: string): CategoryScoreResult {
  return {
    score: 50,
    details: `${category}: Insufficient data for accurate scoring`,
    modifiers: ['limited-data'],
  };
}

/** Map total annual revenue to a benchmarking bucket */
function getRevenueRange(totalAnnualRevenue: number): string {
  if (totalAnnualRevenue >= 10_000_000) return '10m+';
  if (totalAnnualRevenue >= 5_000_000) return '5m-10m';
  if (totalAnnualRevenue >= 1_000_000) return '1m-5m';
  if (totalAnnualRevenue >= 500_000) return '500k-1m';
  return '0-500k';
}

/** Get letter grade from composite score */
function getLetterGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C+';
  if (score >= 50) return 'C';
  if (score >= 40) return 'D+';
  if (score >= 30) return 'D';
  return 'F';
}

/** Get runway label from cash runway score */
function getRunwayLabel(cashRunwayScore: number): 'Good' | 'Needs Attention' | 'Critical' {
  if (cashRunwayScore >= 70) return 'Good';
  if (cashRunwayScore >= 25) return 'Needs Attention';
  return 'Critical';
}

// ==========================================
// Category Scorers
// ==========================================

/**
 * 1. Liquidity Score (20% weight)
 *
 * Base: currentRatio mapped to 0-100
 * Modifier: quickRatio gap > 0.5 reduces score by up to 10
 */
function scoreLiquidity(data: HealthScoreRawData): CategoryScoreResult {
  const currentRatio = data.financialRatios.currentRatio;
  const quickRatio = data.financialRatios.quickRatio;
  const modifiers: string[] = [];

  // Null currentRatio means zero liabilities
  if (currentRatio === null) {
    return {
      score: 95,
      details: 'Current ratio N/A (zero current liabilities). Defaulting to 95.',
      modifiers: ['zero-liabilities'],
    };
  }

  // Map currentRatio to base score
  let baseScore: number;
  if (currentRatio >= 3.0) {
    baseScore = 100;
  } else if (currentRatio >= 2.0) {
    baseScore = interpolate(currentRatio, 2.0, 3.0, 90, 100);
  } else if (currentRatio >= 1.5) {
    baseScore = interpolate(currentRatio, 1.5, 2.0, 75, 89);
  } else if (currentRatio >= 1.0) {
    baseScore = interpolate(currentRatio, 1.0, 1.5, 50, 74);
  } else if (currentRatio >= 0.8) {
    baseScore = interpolate(currentRatio, 0.8, 1.0, 25, 49);
  } else {
    baseScore = interpolate(currentRatio, 0, 0.8, 0, 24);
  }

  // Modifier: quickRatio gap
  if (quickRatio !== null && currentRatio > 0) {
    const gap = currentRatio - quickRatio;
    if (gap > 0.5) {
      // Scale penalty: gap 0.5 = 0 reduction, gap 1.5+ = -10
      const penalty = Math.round(interpolate(gap, 0.5, 1.5, 0, 10));
      baseScore -= penalty;
      modifiers.push(`quick-ratio-gap: -${penalty} (gap=${gap.toFixed(2)})`);
    }
  }

  const finalScore = clamp(Math.round(baseScore), 0, 100);

  return {
    score: finalScore,
    details: `Current ratio: ${currentRatio.toFixed(2)}, Quick ratio: ${quickRatio?.toFixed(2) ?? 'N/A'}`,
    modifiers,
  };
}

/**
 * 2. Receivables Health Score (20% weight)
 *
 * Base: % of total AR that is 61+ days past due
 * Modifier: AR-to-Revenue ratio adjustment
 */
function scoreReceivables(data: HealthScoreRawData): CategoryScoreResult {
  const aging = data.aging.ar;
  const totalAR = aging.total;
  const modifiers: string[] = [];

  // No receivables = good
  if (totalAR <= 0) {
    return {
      score: 90,
      details: 'No accounts receivable outstanding.',
      modifiers: ['zero-ar'],
    };
  }

  // Calculate 61+ days percentage
  const ar61Plus = aging['61-90'] + aging['90+'];
  const ar61PlusPct = safeDivide(ar61Plus, totalAR, 0) * 100;

  // Map to base score
  let baseScore: number;
  if (ar61PlusPct < 10) {
    baseScore = interpolate(ar61PlusPct, 0, 10, 100, 90);
  } else if (ar61PlusPct <= 20) {
    baseScore = interpolate(ar61PlusPct, 10, 20, 89, 70);
  } else if (ar61PlusPct <= 35) {
    baseScore = interpolate(ar61PlusPct, 20, 35, 69, 45);
  } else if (ar61PlusPct <= 50) {
    baseScore = interpolate(ar61PlusPct, 35, 50, 44, 20);
  } else {
    baseScore = interpolate(ar61PlusPct, 50, 100, 19, 0);
  }

  // Modifier: AR-to-Revenue ratio
  const monthlyPL = data.monthlyPL;
  if (monthlyPL.length >= 3) {
    const last3 = monthlyPL.slice(-3);
    const avgMonthlyRevenue = last3.reduce((sum, m) => sum + (m.income || 0), 0) / 3;

    if (avgMonthlyRevenue > 0) {
      const arToRevenueMonths = totalAR / avgMonthlyRevenue;

      if (arToRevenueMonths < 1.0) {
        baseScore += 5;
        modifiers.push(`ar-to-revenue: +5 (${arToRevenueMonths.toFixed(2)} months)`);
      } else if (arToRevenueMonths > 3.0) {
        baseScore -= 20;
        modifiers.push(`ar-to-revenue: -20 (${arToRevenueMonths.toFixed(2)} months, >3.0)`);
      } else if (arToRevenueMonths > 2.0) {
        baseScore -= 10;
        modifiers.push(`ar-to-revenue: -10 (${arToRevenueMonths.toFixed(2)} months, >2.0)`);
      }
      // 1.0-2.0 range: no modifier
    }
  } else {
    modifiers.push('ar-to-revenue: insufficient P&L data for modifier');
  }

  const finalScore = clamp(Math.round(baseScore), 0, 100);

  return {
    score: finalScore,
    details: `AR 61+ days: ${ar61PlusPct.toFixed(1)}% of total AR ($${totalAR.toFixed(0)})`,
    modifiers,
  };
}

/**
 * 3. Revenue Trend Score (20% weight)
 *
 * Base: 3-month linear regression slope normalized as monthly % change
 * Modifier: 6-month stability check, single-month concentration penalty
 */
function scoreRevenueTrend(data: HealthScoreRawData): CategoryScoreResult {
  const monthlyPL = data.monthlyPL;
  const modifiers: string[] = [];

  if (monthlyPL.length < 3) {
    return limitedDataResult('Revenue Trend');
  }

  // --- 3-month trend ---
  const last3 = monthlyPL.slice(-3);
  const incomes3 = last3.map((m) => m.income || 0);
  const slope3 = linearRegressionSlope(incomes3);
  const avgIncome3 = incomes3.reduce((s, v) => s + v, 0) / incomes3.length;

  // Handle zero-revenue edge case
  if (avgIncome3 <= 0) {
    return {
      score: 30,
      details: 'Average 3-month revenue is zero or negative. Limited scoring.',
      modifiers: ['zero-revenue'],
    };
  }

  const monthlyPctChange3 = (slope3 / avgIncome3) * 100;

  // Map 3-month trend to base score
  let baseScore: number;
  if (monthlyPctChange3 > 5) {
    baseScore = interpolate(monthlyPctChange3, 5, 15, 90, 100);
  } else if (monthlyPctChange3 >= 2) {
    baseScore = interpolate(monthlyPctChange3, 2, 5, 75, 89);
  } else if (monthlyPctChange3 >= 0) {
    baseScore = interpolate(monthlyPctChange3, 0, 2, 60, 74);
  } else if (monthlyPctChange3 >= -2) {
    baseScore = interpolate(monthlyPctChange3, -2, 0, 40, 59);
  } else if (monthlyPctChange3 >= -5) {
    baseScore = interpolate(monthlyPctChange3, -5, -2, 20, 39);
  } else {
    baseScore = interpolate(monthlyPctChange3, -15, -5, 0, 19);
  }

  // --- 6-month stability modifier ---
  let monthlyPctChange6 = 0;
  if (monthlyPL.length >= 6) {
    const last6 = monthlyPL.slice(-6);
    const incomes6 = last6.map((m) => m.income || 0);
    const slope6 = linearRegressionSlope(incomes6);
    const avgIncome6 = incomes6.reduce((s, v) => s + v, 0) / incomes6.length;

    if (avgIncome6 > 0) {
      monthlyPctChange6 = (slope6 / avgIncome6) * 100;

      // Check for directional contradiction
      const directionsConflict =
        (monthlyPctChange3 > 1 && monthlyPctChange6 < -1) ||
        (monthlyPctChange3 < -1 && monthlyPctChange6 > 1);

      if (directionsConflict) {
        // Adjust toward middle (score 50) by up to 15 points
        const adjustment = Math.min(15, Math.abs(baseScore - 50) * 0.3);
        if (baseScore > 50) {
          baseScore -= adjustment;
          modifiers.push(`6m-stability: -${adjustment.toFixed(0)} (3m/6m directional conflict)`);
        } else {
          baseScore += adjustment;
          modifiers.push(`6m-stability: +${adjustment.toFixed(0)} (3m/6m directional conflict)`);
        }
      }
    }

    // --- Concentration check ---
    const totalIncome6 = incomes6.reduce((s, v) => s + v, 0);
    if (totalIncome6 > 0) {
      const maxSingleMonth = Math.max(...incomes6);
      const concentrationPct = (maxSingleMonth / totalIncome6) * 100;
      if (concentrationPct > 40) {
        baseScore -= 10;
        modifiers.push(`concentration: -10 (single month = ${concentrationPct.toFixed(1)}% of 6m total)`);
      }
    }
  }

  const finalScore = clamp(Math.round(baseScore), 0, 100);

  return {
    score: finalScore,
    details: `3m trend: ${monthlyPctChange3 >= 0 ? '+' : ''}${monthlyPctChange3.toFixed(2)}%/mo, 6m trend: ${monthlyPctChange6 >= 0 ? '+' : ''}${monthlyPctChange6.toFixed(2)}%/mo`,
    modifiers,
  };
}

/**
 * 4. Profitability Score (15% weight)
 *
 * Base: Net margin (trailing 3-month average)
 * Modifiers: overhead ratio penalty, consecutive margin decline penalty
 */
function scoreProfitability(data: HealthScoreRawData): CategoryScoreResult {
  const monthlyPL = data.monthlyPL;
  const modifiers: string[] = [];

  if (monthlyPL.length < 3) {
    return limitedDataResult('Profitability');
  }

  // --- Trailing 3-month net margin ---
  const last3 = monthlyPL.slice(-3);
  const totalNetIncome3 = last3.reduce((sum, m) => sum + (m.netIncome || 0), 0);
  const totalIncome3 = last3.reduce((sum, m) => sum + (m.income || 0), 0);

  // Handle zero revenue
  if (totalIncome3 <= 0) {
    return {
      score: totalNetIncome3 < 0 ? 5 : 30,
      details: 'Zero revenue in trailing 3 months. Limited scoring.',
      modifiers: ['zero-revenue'],
    };
  }

  const netMarginPct = (totalNetIncome3 / totalIncome3) * 100;

  // Map net margin to base score
  let baseScore: number;
  if (netMarginPct > 20) {
    baseScore = interpolate(netMarginPct, 20, 40, 90, 100);
  } else if (netMarginPct >= 10) {
    baseScore = interpolate(netMarginPct, 10, 20, 70, 89);
  } else if (netMarginPct >= 5) {
    baseScore = interpolate(netMarginPct, 5, 10, 50, 69);
  } else if (netMarginPct >= 0) {
    baseScore = interpolate(netMarginPct, 0, 5, 30, 49);
  } else if (netMarginPct >= -5) {
    baseScore = interpolate(netMarginPct, -5, 0, 10, 29);
  } else {
    baseScore = interpolate(netMarginPct, -20, -5, 0, 9);
  }

  // --- Overhead modifier ---
  // overheadRatio = opex / revenue
  const totalExpenses3 = last3.reduce((sum, m) => sum + (m.expenses || 0), 0);
  const overheadRatio = safeDivide(totalExpenses3, totalIncome3, 0) * 100;

  if (overheadRatio > 75) {
    baseScore -= 10;
    modifiers.push(`overhead: -10 (${overheadRatio.toFixed(1)}% of revenue)`);
  }

  // --- Margin trend modifier: 3+ consecutive months of decline in last 6 ---
  let marginTrendDecline = false;
  if (monthlyPL.length >= 4) {
    const lookback = monthlyPL.slice(-6);
    let consecutiveDeclines = 0;
    let maxConsecutiveDeclines = 0;

    for (let i = 1; i < lookback.length; i++) {
      const prevIncome = lookback[i - 1].income || 0;
      const currIncome = lookback[i].income || 0;
      const prevMargin = prevIncome > 0 ? ((lookback[i - 1].netIncome || 0) / prevIncome) * 100 : 0;
      const currMargin = currIncome > 0 ? ((lookback[i].netIncome || 0) / currIncome) * 100 : 0;

      if (currMargin < prevMargin) {
        consecutiveDeclines++;
        maxConsecutiveDeclines = Math.max(maxConsecutiveDeclines, consecutiveDeclines);
      } else {
        consecutiveDeclines = 0;
      }
    }

    if (maxConsecutiveDeclines >= 3) {
      baseScore -= 10;
      marginTrendDecline = true;
      modifiers.push(`margin-trend: -10 (${maxConsecutiveDeclines} consecutive months of declining margin)`);
    }
  }

  const finalScore = clamp(Math.round(baseScore), 0, 100);

  return {
    score: finalScore,
    details: `Net margin (3m avg): ${netMarginPct.toFixed(1)}%, Overhead ratio: ${overheadRatio.toFixed(1)}%`,
    modifiers,
  };
}

/**
 * 5. Cash Runway Score (25% weight -- CORE metric)
 *
 * Base: months of cash runway (cash / monthly burn)
 * Modifiers: cash trend decline, AR-adjusted runway bonus
 */
function scoreCashRunway(data: HealthScoreRawData): CategoryScoreResult {
  const monthlyPL = data.monthlyPL;
  const modifiers: string[] = [];

  if (monthlyPL.length < 3) {
    return limitedDataResult('Cash Runway');
  }

  const cash = data.balanceSheet.assets.cashAndEquivalents;

  // --- Monthly burn = average of last 3 months total outflows (expenses + COGS) ---
  const last3 = monthlyPL.slice(-3);
  const totalOutflows3 = last3.reduce((sum, m) => sum + Math.abs(m.expenses || 0) + Math.abs(m.cogs || 0), 0);
  const monthlyBurn = totalOutflows3 / 3;

  // Handle zero burn (profitable with no expenses -- unlikely but handle it)
  if (monthlyBurn <= 0) {
    return {
      score: 100,
      details: `Cash: $${cash.toFixed(0)}, Monthly burn: $0. No cash drain detected.`,
      modifiers: ['zero-burn'],
    };
  }

  const runwayMonths = cash / monthlyBurn;

  // Map runway to base score
  let baseScore: number;
  if (runwayMonths > 12) {
    baseScore = interpolate(runwayMonths, 12, 24, 90, 100);
  } else if (runwayMonths >= 6) {
    baseScore = interpolate(runwayMonths, 6, 12, 70, 89);
  } else if (runwayMonths >= 4) {
    baseScore = interpolate(runwayMonths, 4, 6, 50, 69);
  } else if (runwayMonths >= 2) {
    baseScore = interpolate(runwayMonths, 2, 4, 25, 49);
  } else {
    baseScore = interpolate(runwayMonths, 0, 2, 0, 24);
  }

  // --- Trend modifier: compare current cash to 3 months ago ---
  let cashTrendDecline = false;
  if (monthlyPL.length >= 4) {
    // Estimate cash 3 months ago by summing net incomes backward
    // This is an approximation: cash_3m_ago ~ cash - sum(last 3 months netIncome)
    const netIncomeLast3 = last3.reduce((sum, m) => sum + (m.netIncome || 0), 0);
    const estimatedCash3MonthsAgo = cash - netIncomeLast3;

    if (estimatedCash3MonthsAgo > 0) {
      const cashDeclinePct = ((estimatedCash3MonthsAgo - cash) / estimatedCash3MonthsAgo) * 100;
      if (cashDeclinePct >= 20) {
        baseScore -= 15;
        cashTrendDecline = true;
        modifiers.push(`cash-trend: -15 (cash declined ~${cashDeclinePct.toFixed(0)}% over 3 months)`);
      }
    }
  }

  // --- AR modifier: add 50% of current AR bucket to cash for adjusted runway ---
  const currentAR = data.aging.ar['0-30'];
  if (currentAR > 0) {
    const adjustedCash = cash + currentAR * 0.5;
    const adjustedRunway = adjustedCash / monthlyBurn;

    // Calculate what score would be with adjusted runway
    let adjustedScore: number;
    if (adjustedRunway > 12) {
      adjustedScore = interpolate(adjustedRunway, 12, 24, 90, 100);
    } else if (adjustedRunway >= 6) {
      adjustedScore = interpolate(adjustedRunway, 6, 12, 70, 89);
    } else if (adjustedRunway >= 4) {
      adjustedScore = interpolate(adjustedRunway, 4, 6, 50, 69);
    } else if (adjustedRunway >= 2) {
      adjustedScore = interpolate(adjustedRunway, 2, 4, 25, 49);
    } else {
      adjustedScore = interpolate(adjustedRunway, 0, 2, 0, 24);
    }

    // Only apply if adjusted score is better, capped at +10 bonus
    if (adjustedScore > baseScore) {
      const bonus = Math.min(10, Math.round(adjustedScore - baseScore));
      baseScore += bonus;
      modifiers.push(`ar-adjusted-runway: +${bonus} (adjusted runway: ${adjustedRunway.toFixed(1)} months)`);
    }
  }

  const finalScore = clamp(Math.round(baseScore), 0, 100);

  return {
    score: finalScore,
    details: `Cash runway: ${runwayMonths.toFixed(1)} months (cash: $${cash.toFixed(0)}, burn: $${monthlyBurn.toFixed(0)}/mo)`,
    modifiers,
  };
}

// ==========================================
// Metrics Snapshot Builder
// ==========================================

function buildMetricsSnapshot(data: HealthScoreRawData): MetricsSnapshot {
  const monthlyPL = data.monthlyPL;
  const aging = data.aging.ar;
  const totalAR = aging.total;

  // Liquidity
  const currentRatio = data.financialRatios.currentRatio;
  const quickRatio = data.financialRatios.quickRatio;

  // Receivables
  const ar61Plus = aging['61-90'] + aging['90+'];
  const ar61PlusPct = totalAR > 0 ? (ar61Plus / totalAR) * 100 : 0;

  const last3Months = monthlyPL.slice(-3);
  const avgMonthlyRevenue3 =
    last3Months.length > 0
      ? last3Months.reduce((sum, m) => sum + (m.income || 0), 0) / last3Months.length
      : 0;
  const arToRevenueMonths = avgMonthlyRevenue3 > 0 ? totalAR / avgMonthlyRevenue3 : 0;
  const dso = data.coreMetrics.dso || 0;

  // Revenue trends
  let revenueTrend3m = 0;
  let revenueTrend6m = 0;
  let revenueConcentrationFlag = false;

  if (last3Months.length >= 3) {
    const incomes3 = last3Months.map((m) => m.income || 0);
    const slope3 = linearRegressionSlope(incomes3);
    const avg3 = incomes3.reduce((s, v) => s + v, 0) / incomes3.length;
    revenueTrend3m = avg3 > 0 ? (slope3 / avg3) * 100 : 0;
  }

  if (monthlyPL.length >= 6) {
    const last6 = monthlyPL.slice(-6);
    const incomes6 = last6.map((m) => m.income || 0);
    const slope6 = linearRegressionSlope(incomes6);
    const avg6 = incomes6.reduce((s, v) => s + v, 0) / incomes6.length;
    revenueTrend6m = avg6 > 0 ? (slope6 / avg6) * 100 : 0;

    const totalIncome6 = incomes6.reduce((s, v) => s + v, 0);
    if (totalIncome6 > 0) {
      const maxMonth = Math.max(...incomes6);
      revenueConcentrationFlag = (maxMonth / totalIncome6) * 100 > 40;
    }
  }

  // Profitability
  const grossMargin = data.financialRatios.grossProfitMargin;
  const totalIncome3 = last3Months.reduce((sum, m) => sum + (m.income || 0), 0);
  const totalNetIncome3 = last3Months.reduce((sum, m) => sum + (m.netIncome || 0), 0);
  const netMargin = totalIncome3 > 0 ? (totalNetIncome3 / totalIncome3) * 100 : null;
  const totalExpenses3 = last3Months.reduce((sum, m) => sum + (m.expenses || 0), 0);
  const overheadRatio = totalIncome3 > 0 ? (totalExpenses3 / totalIncome3) * 100 : 0;

  // Margin trend decline detection
  let marginTrendDecline = false;
  if (monthlyPL.length >= 4) {
    const lookback = monthlyPL.slice(-6);
    let consecutiveDeclines = 0;
    for (let i = 1; i < lookback.length; i++) {
      const prevIncome = lookback[i - 1].income || 0;
      const currIncome = lookback[i].income || 0;
      const prevMargin = prevIncome > 0 ? ((lookback[i - 1].netIncome || 0) / prevIncome) * 100 : 0;
      const currMargin = currIncome > 0 ? ((lookback[i].netIncome || 0) / currIncome) * 100 : 0;

      if (currMargin < prevMargin) {
        consecutiveDeclines++;
        if (consecutiveDeclines >= 3) {
          marginTrendDecline = true;
          break;
        }
      } else {
        consecutiveDeclines = 0;
      }
    }
  }

  // Cash runway
  const totalOutflows3 = last3Months.reduce(
    (sum, m) => sum + Math.abs(m.expenses || 0) + Math.abs(m.cogs || 0),
    0,
  );
  const monthlyBurn = last3Months.length > 0 ? totalOutflows3 / last3Months.length : 0;
  const cash = data.balanceSheet.assets.cashAndEquivalents;
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : monthlyBurn === 0 ? 999 : 0;

  // Cash trend decline
  let cashTrendDecline = false;
  if (monthlyPL.length >= 4 && last3Months.length === 3) {
    const netIncomeLast3 = last3Months.reduce((sum, m) => sum + (m.netIncome || 0), 0);
    const estimatedCash3MonthsAgo = cash - netIncomeLast3;
    if (estimatedCash3MonthsAgo > 0) {
      const cashDeclinePct = ((estimatedCash3MonthsAgo - cash) / estimatedCash3MonthsAgo) * 100;
      cashTrendDecline = cashDeclinePct >= 20;
    }
  }

  // Revenue range
  const totalAnnualRevenue = monthlyPL.reduce((sum, m) => sum + (m.income || 0), 0);
  const revenueRange = getRevenueRange(totalAnnualRevenue);

  return {
    currentRatio,
    quickRatio,
    ar61PlusPct: Math.round(ar61PlusPct * 10) / 10,
    arToRevenueMonths: Math.round(arToRevenueMonths * 100) / 100,
    dso,
    revenueTrend3m: Math.round(revenueTrend3m * 100) / 100,
    revenueTrend6m: Math.round(revenueTrend6m * 100) / 100,
    revenueConcentrationFlag,
    grossMargin: grossMargin !== null ? Math.round(grossMargin * 10) / 10 : null,
    netMargin: netMargin !== null ? Math.round(netMargin * 10) / 10 : null,
    overheadRatio: Math.round(overheadRatio * 10) / 10,
    marginTrendDecline,
    runwayMonths: Math.round(runwayMonths * 10) / 10,
    monthlyBurn: Math.round(monthlyBurn),
    cashTrendDecline,
    revenueRange,
  };
}

// ==========================================
// Cash Projection Builder
// ==========================================

function buildCashProjection(data: HealthScoreRawData): CashProjection {
  const monthlyPL = data.monthlyPL;
  const currentCash = data.balanceSheet.assets.cashAndEquivalents;
  const currentAR = data.aging.ar['0-30'];

  const last3 = monthlyPL.slice(-3);
  const avgMonthlyRev =
    last3.length > 0 ? last3.reduce((sum, m) => sum + (m.income || 0), 0) / last3.length : 0;

  const totalOutflows3 = last3.reduce(
    (sum, m) => sum + Math.abs(m.expenses || 0) + Math.abs(m.cogs || 0),
    0,
  );
  const burn = last3.length > 0 ? totalOutflows3 / last3.length : 0;

  const projected30d = currentCash + currentAR * 0.85 - burn;
  const projected60d = projected30d + avgMonthlyRev * 0.9 - burn;
  const projected90d = projected60d + avgMonthlyRev * 0.85 - burn;

  return {
    currentCash: Math.round(currentCash * 100) / 100,
    monthlyBurn: Math.round(burn * 100) / 100,
    projected30d: Math.round(projected30d * 100) / 100,
    projected60d: Math.round(projected60d * 100) / 100,
    projected90d: Math.round(projected90d * 100) / 100,
  };
}

// ==========================================
// Main Export
// ==========================================

/**
 * Deterministic health score calculation engine.
 * Pure function -- takes parsed QB data, returns scores. No I/O.
 */
export function calculateHealthScore(data: HealthScoreRawData): HealthScoreResult {
  // Run all 5 category scorers
  const liquidityScore = scoreLiquidity(data);
  const receivablesScore = scoreReceivables(data);
  const revenueTrendScore = scoreRevenueTrend(data);
  const profitabilityScore = scoreProfitability(data);
  const cashRunwayScore = scoreCashRunway(data);

  // Composite score (weighted average)
  const composite = Math.round(
    0.2 * liquidityScore.score +
      0.2 * receivablesScore.score +
      0.2 * revenueTrendScore.score +
      0.15 * profitabilityScore.score +
      0.25 * cashRunwayScore.score,
  );
  const compositeScore = clamp(composite, 0, 100);

  // Letter grade
  const letterGrade = getLetterGrade(compositeScore);

  // Runway label
  const runwayLabel = getRunwayLabel(cashRunwayScore.score);

  // Metrics snapshot
  const metricsSnapshot = buildMetricsSnapshot(data);

  // Cash projection
  const cashProjection = buildCashProjection(data);

  return {
    compositeScore,
    letterGrade,
    runwayLabel,
    liquidityScore,
    receivablesScore,
    revenueTrendScore,
    profitabilityScore,
    cashRunwayScore,
    metricsSnapshot,
    cashProjection,
  };
}
