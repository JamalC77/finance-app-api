import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { financialInsightService } from '../services/insights/financialInsightService';
import { bigQueryService } from '../services/google/bigQueryService';
import { formatErrorResponse } from '../utils/errors';
import { prisma } from '../models/prisma';

const router = express.Router();

// All insights routes require authentication
router.use(authMiddleware);

/**
 * Get all insights for the current organization
 */
router.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const includeRead = req.query.includeRead === 'true';
    
    const insights = await financialInsightService.getInsights(organizationId, limit, includeRead);
    res.json({ success: true, data: insights });
  } catch (error) {
    console.error('Error fetching insights:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Generate new insights for the current organization
 */
router.post('/generate', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    const insightCount = await financialInsightService.generateAllInsights(organizationId);
    
    res.json({ success: true, message: `Generated ${insightCount} insights` });
  } catch (error) {
    console.error('Error generating insights:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Get a specific insight
 */
router.get('/:insightId', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const { insightId } = req.params;
    const organizationId = req.user.organizationId;
    
    const insight = await prisma.financialInsight.findUnique({
      where: { 
        id: insightId,
        organizationId 
      }
    });
    
    if (!insight) {
      return res.status(404).json(formatErrorResponse({ 
        statusCode: 404, 
        message: 'Insight not found' 
      }));
    }
    
    res.json({ success: true, data: insight });
  } catch (error) {
    console.error('Error getting insight:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Mark an insight as read
 */
router.patch('/:insightId/read', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const { insightId } = req.params;
    const organizationId = req.user.organizationId;
    
    // Verify the insight belongs to this organization
    const insight = await prisma.financialInsight.findUnique({
      where: { 
        id: insightId
      }
    });
    
    if (!insight || insight.organizationId !== organizationId) {
      return res.status(404).json(formatErrorResponse({ 
        statusCode: 404, 
        message: 'Insight not found' 
      }));
    }
    
    await financialInsightService.markInsightAsRead(insightId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking insight as read:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Mark all insights as read
 */
router.patch('/all/read', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    await financialInsightService.markAllInsightsAsRead(organizationId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all insights as read:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Get cash flow analysis
 */
router.get('/analysis/cashflow', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Default to last 12 months
    const startDate = req.query.startDate 
      ? new Date(req.query.startDate as string) 
      : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
    
    const endDate = req.query.endDate 
      ? new Date(req.query.endDate as string) 
      : new Date();
    
    // Analyze cash flow using BigQuery
    const results = await bigQueryService.analyzeCashFlow(organizationId, startDate, endDate);
    
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error analyzing cash flow:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Get expense trends analysis
 */
router.get('/analysis/expenses', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Default to last 6 months
    const months = req.query.months 
      ? parseInt(req.query.months as string) 
      : 6;
    
    // Analyze expense trends using BigQuery
    const results = await bigQueryService.analyzeExpenseTrends(organizationId, months);
    
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error analyzing expenses:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Get profitability analysis
 */
router.get('/analysis/profitability', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Default to last 12 months
    const months = req.query.months 
      ? parseInt(req.query.months as string) 
      : 12;
    
    // Get profitability analysis using BigQuery
    const results = await bigQueryService.getMonthlyProfitability(organizationId, months);
    
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error analyzing profitability:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Export data to BigQuery for analysis
 */
router.post('/export', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // This might be a long operation, so don't wait for it to complete
    Promise.all([
      bigQueryService.exportTransactions(organizationId),
      bigQueryService.exportAccounts(organizationId)
    ])
      .then(([transactionCount, accountCount]) => {
        console.log(`Exported ${transactionCount} transactions and ${accountCount} accounts for ${organizationId}`);
      })
      .catch(error => {
        console.error(`Error exporting data for ${organizationId}:`, error);
      });
    
    res.json({ 
      success: true, 
      message: 'Data export to analytics started.' 
    });
  } catch (error) {
    console.error('Error starting data export:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

/**
 * Initialize BigQuery for a new organization
 */
router.post('/setup-analytics', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json(formatErrorResponse({
        statusCode: 401,
        message: 'User not authenticated'
      }));
    }
    
    const organizationId = req.user.organizationId;
    
    // Initialize BigQuery for this organization
    await bigQueryService.initializeForOrganization(organizationId);
    
    res.json({ 
      success: true, 
      message: 'Analytics setup completed successfully.' 
    });
  } catch (error) {
    console.error('Error setting up analytics:', error);
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as any).statusCode : 500;
    res.status(statusCode).json(formatErrorResponse(error));
  }
});

export default router; 