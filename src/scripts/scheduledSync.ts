/**
 * Scheduled job to sync data from QuickBooks and generate insights
 * Run this script on a regular schedule (e.g., using cron)
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { quickbooksSyncController } from '../controllers/quickbooks/quickbooksSyncController';
import { financialInsightService } from '../services/insights/financialInsightService';
import { bigQueryService } from '../services/google/bigQueryService';

// Load environment variables
dotenv.config();

// Initialize Prisma client
const prisma = new PrismaClient();

/**
 * Main function to run the scheduled sync
 */
async function runScheduledSync() {
  console.log('Starting scheduled sync job at', new Date().toISOString());
  
  try {
    // Get all organizations with active QuickBooks connections
    const connections = await prisma.quickbooksConnection.findMany({
      where: { isActive: true },
      include: { organization: true }
    });
    
    console.log(`Found ${connections.length} active QuickBooks connections`);
    
    // Process each connection based on sync frequency
    for (const connection of connections) {
      const organizationId = connection.organizationId;
      const now = new Date();
      
      // Skip if too soon since last sync
      if (connection.lastSyncedAt && shouldSkipSync(connection.lastSyncedAt, connection.syncFrequency, now)) {
        console.log(`Skipping sync for organization ${organizationId} - last synced at ${connection.lastSyncedAt.toISOString()}`);
        continue;
      }
      
      console.log(`Starting sync for organization ${organizationId}...`);
      
      try {
        // Sync data from QuickBooks
        await quickbooksSyncController.startFullSync(organizationId);
        console.log(`Completed QuickBooks sync for organization ${organizationId}`);
        
        // Export data to BigQuery for analytics
        await Promise.all([
          bigQueryService.exportTransactions(organizationId),
          bigQueryService.exportAccounts(organizationId)
        ]);
        console.log(`Completed BigQuery export for organization ${organizationId}`);
        
        // Generate insights from the data
        const insightCount = await financialInsightService.generateAllInsights(organizationId);
        console.log(`Generated ${insightCount} insights for organization ${organizationId}`);
        
        console.log(`Completed all tasks for organization ${organizationId}`);
      } catch (error) {
        console.error(`Error processing organization ${organizationId}:`, error);
        // Continue with next organization
      }
    }
  } catch (error) {
    console.error('Fatal error in scheduled sync job:', error);
  } finally {
    await prisma.$disconnect();
    console.log('Scheduled sync job completed at', new Date().toISOString());
  }
}

/**
 * Determine if sync should be skipped based on frequency
 */
function shouldSkipSync(lastSyncedAt: Date, syncFrequency: string, now: Date): boolean {
  const hoursSinceLastSync = (now.getTime() - lastSyncedAt.getTime()) / (1000 * 60 * 60);
  
  switch (syncFrequency) {
    case 'HOURLY':
      return hoursSinceLastSync < 1;
    case 'DAILY':
      return hoursSinceLastSync < 24;
    case 'WEEKLY':
      return hoursSinceLastSync < 24 * 7;
    case 'MONTHLY':
      return hoursSinceLastSync < 24 * 30;
    case 'MANUAL':
      return true; // Always skip automatic sync for manual frequency
    default:
      return false;
  }
}

// Run the job
runScheduledSync()
  .catch(error => {
    console.error('Unhandled error in scheduled sync job:', error);
    process.exit(1);
  }); 