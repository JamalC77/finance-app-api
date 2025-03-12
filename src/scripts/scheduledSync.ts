/**
 * Scheduled QuickBooks Synchronization Script
 * 
 * This script is designed to be run by a scheduler (e.g., cron) at regular intervals.
 * It checks for organizations with QuickBooks connections and runs syncs based on
 * their configured frequency.
 */

import { prisma } from '../utils/prisma';
import { quickbooksSyncController } from '../controllers/quickbooks/quickbooksSyncController';
import { snowflakeController } from '../controllers/snowflakeController';
import { quickbooksToSnowflakeController } from '../controllers/quickbooks/quickbooksToSnowflakeController';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Flag to determine whether to use direct export
const USE_DIRECT_EXPORT = process.env.USE_DIRECT_EXPORT === 'true';

async function main() {
  console.log('Starting scheduled QuickBooks sync job at', new Date().toISOString());
  console.log(`Using ${USE_DIRECT_EXPORT ? 'direct export' : 'standard export'} mode`);
  
  try {
    // Get all active QuickBooks connections
    const activeConnections = await prisma.quickbooksConnection.findMany({
      where: {
        isActive: true
      },
      select: {
        id: true,
        organizationId: true,
        syncFrequency: true,
        lastSyncedAt: true
      }
    });
    
    console.log(`Found ${activeConnections.length} active QuickBooks connections`);
    
    // Process each connection
    const now = new Date();
    for (const connection of activeConnections) {
      try {
        // Determine if sync is due based on frequency
        let shouldSync = false;
        
        if (!connection.lastSyncedAt) {
          // Never synced before, so sync now
          shouldSync = true;
        } else {
          const hoursSinceLastSync = (now.getTime() - connection.lastSyncedAt.getTime()) / (1000 * 60 * 60);
          
          // Check if enough time has elapsed since the last sync based on frequency
          switch (connection.syncFrequency) {
            case 'HOURLY':
              shouldSync = hoursSinceLastSync >= 1;
              break;
            case 'DAILY':
              shouldSync = hoursSinceLastSync >= 24;
              break;
            case 'WEEKLY':
              shouldSync = hoursSinceLastSync >= 168; // 7 * 24
              break;
            case 'MONTHLY':
              shouldSync = hoursSinceLastSync >= 720; // 30 * 24
              break;
            case 'MANUAL':
              // Don't automatically sync for manual frequency
              shouldSync = false;
              break;
          }
        }
        
        // Perform sync if due
        if (shouldSync) {
          console.log(`Starting sync for organization ${connection.organizationId} (frequency: ${connection.syncFrequency})`);
          
          // Temporarily using only the global setting for direct export
          const useDirectExport = USE_DIRECT_EXPORT;
          
          if (useDirectExport) {
            // Use direct export to Snowflake
            console.log(`Using direct export for organization ${connection.organizationId}`);
            await quickbooksToSnowflakeController.startDirectExport(connection.organizationId);
            
            // Update the last synced timestamp
            await prisma.quickbooksConnection.update({
              where: { organizationId: connection.organizationId },
              data: { lastSyncedAt: new Date() }
            });
            
            console.log(`Completed direct export for organization ${connection.organizationId}`);
          } else {
            // Use standard sync process
            console.log(`Using standard sync for organization ${connection.organizationId}`);
            await quickbooksSyncController.startFullSync(connection.organizationId);
            console.log(`Completed sync for organization ${connection.organizationId}`);
            
            // After QuickBooks sync is complete, export to Snowflake if configured
            if (process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USERNAME && process.env.SNOWFLAKE_PASSWORD) {
              try {
                console.log(`Starting Snowflake export for organization ${connection.organizationId}`);
                await snowflakeController.createExportLog(connection.organizationId, 'IN_PROGRESS');
                
                const exportCounts = await snowflakeController.exportAllData(connection.organizationId);
                await snowflakeController.createExportLog(connection.organizationId, 'COMPLETED', exportCounts);
                
                console.log(`Completed Snowflake export for organization ${connection.organizationId}`);
              } catch (snowflakeError) {
                console.error(`Error exporting to Snowflake for org ${connection.organizationId}:`, snowflakeError);
                const errorMessage = snowflakeError instanceof Error ? snowflakeError.message : 'Unknown error';
                await snowflakeController.createExportLog(connection.organizationId, 'FAILED', undefined, errorMessage);
              }
            }
          }
        } else {
          console.log(`Skipping sync for organization ${connection.organizationId} (not due yet, frequency: ${connection.syncFrequency})`);
        }
      } catch (connectionError) {
        // Log error but continue with other connections
        console.error(`Error processing connection for org ${connection.organizationId}:`, connectionError);
      }
    }
    
    console.log('Scheduled QuickBooks sync job completed at', new Date().toISOString());
  } catch (error) {
    console.error('Error in scheduled QuickBooks sync job:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Unhandled error in scheduled sync script:', error);
    process.exit(1);
  }); 