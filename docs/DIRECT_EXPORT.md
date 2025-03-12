# Direct QuickBooks to Snowflake Export

This document provides an overview of the direct QuickBooks to Snowflake export feature, including setup instructions, usage guidelines, and technical details.

## Overview

The direct export feature allows you to export data from QuickBooks directly to Snowflake without storing it in the application database. This approach offers several benefits:

- **Reduced Storage Requirements**: Data is not duplicated in the application database
- **Improved Performance**: Bypasses the application database for large datasets
- **Real-time Analytics**: Data is available in Snowflake immediately for analysis
- **Single Source of Truth**: Maintains Snowflake as the primary data repository

## Setup Instructions

### Prerequisites

1. A QuickBooks Online account connected to the Finance App
2. Snowflake account configured with the Finance App
3. Proper permissions set up in both QuickBooks and Snowflake

### Configuration

1. **Enable Direct Export**:
   - Go to Settings → Integrations → QuickBooks
   - Toggle the "Direct Export" switch to enable the feature
   - Click "Save Settings"

2. **Environment Configuration**:
   Add the following environment variables to your `.env` file:

   ```
   # Direct Export Configuration
   USE_DIRECT_EXPORT=true  # Set to 'true' to use direct export by default
   ```

3. **Database Schema**:
   The direct export feature requires the `directExportLog` table in your database. If you're using Prisma, add the following to your schema:

   ```prisma
   model DirectExportLog {
     id              String    @id @default(uuid())
     organizationId  String
     status          String    // 'IN_PROGRESS', 'COMPLETED', 'FAILED'
     startedAt       DateTime
     completedAt     DateTime?
     entityType      String?   // 'accounts', 'transactions', 'invoices', 'contacts', or null for all
     accountsCount   Int?
     transactionsCount Int?
     invoicesCount   Int?
     contactsCount   Int?
     errorMessage    String?
     createdAt       DateTime  @default(now())
     updatedAt       DateTime  @updatedAt
     
     organization    Organization @relation(fields: [organizationId], references: [id])
     
     @@index([organizationId])
     @@index([status])
   }
   
   model QuickbooksConnection {
     // ... existing fields
     useDirectExport Boolean?  // Whether to use direct export for this connection
   }
   ```

   Then run the migration:
   ```bash
   npx prisma migrate dev --name add-direct-export
   ```

## Usage

### Manual Export

You can manually trigger a direct export in two ways:

1. **From the UI**:
   - Go to Settings → Integrations → QuickBooks
   - Click the "Direct Export" button
   - Select the type of data to export (All Data, Accounts, Transactions, Invoices, or Contacts)

2. **Using the API**:
   ```
   POST /api/quickbooks/direct-export
   ```
   or for specific entity types:
   ```
   POST /api/quickbooks/direct-export/:entityType
   ```
   where `:entityType` is one of: `accounts`, `transactions`, `invoices`, `contacts`

### Scheduled Export

The system can automatically perform direct exports based on the configured sync frequency:

1. **Configure Sync Frequency**:
   - Go to Settings → Integrations → QuickBooks
   - Select the desired frequency (Hourly, Daily, Weekly, Monthly)
   - Make sure "Direct Export" is enabled

2. **Set Up Scheduled Job**:
   Add a cron job to run the scheduled sync script:
   ```bash
   # Run every hour
   0 * * * * cd /path/to/finance-app-api && npx ts-node src/scripts/scheduledSync.ts >> logs/quickbooks-sync.log 2>&1
   ```

## Technical Details

### Architecture

The direct export process follows these steps:

1. **Authentication**: The system authenticates with QuickBooks using OAuth
2. **Data Retrieval**: Data is fetched from QuickBooks API
3. **Transformation**: Data is transformed to match Snowflake schema
4. **Direct Loading**: Transformed data is loaded directly into Snowflake
5. **Logging**: The process is logged for monitoring and troubleshooting

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quickbooks/direct-export` | POST | Export all data directly to Snowflake |
| `/api/quickbooks/direct-export/:entityType` | POST | Export specific entity type |
| `/api/quickbooks/direct-export/status` | GET | Get status of the most recent export |
| `/api/quickbooks/direct-export/history` | GET | Get history of direct exports |

### Data Flow

```
QuickBooks API → Finance App → Snowflake
```

Unlike the standard sync process, data is not stored in the application database:

```
Standard: QuickBooks API → Finance App DB → Snowflake
Direct:   QuickBooks API → Snowflake
```

## Monitoring and Troubleshooting

### Export Logs

You can view the export logs in two ways:

1. **From the UI**:
   - Go to Settings → Integrations → QuickBooks
   - Click "View Export History"

2. **Using the API**:
   ```
   GET /api/quickbooks/direct-export/history
   ```

### Common Issues

#### Export Fails with Authentication Error

- Check that your QuickBooks connection is active
- Verify that the OAuth tokens are valid and not expired
- Reconnect to QuickBooks if necessary

#### Export Fails with Snowflake Error

- Verify Snowflake credentials in environment variables
- Check that the Snowflake account is active
- Ensure proper permissions are set up in Snowflake

#### Data Not Appearing in Snowflake

- Check the export logs for any errors
- Verify that the correct schema and tables exist in Snowflake
- Ensure the organization ID is correctly mapped

## Best Practices

1. **Schedule During Off-Hours**: Schedule large exports during off-hours to minimize impact on system performance
2. **Monitor Export Logs**: Regularly check export logs for errors or warnings
3. **Incremental Exports**: Use entity-specific exports for incremental updates
4. **Backup Strategy**: Implement a backup strategy for critical data in Snowflake

## Limitations

- Direct export is only available for QuickBooks data
- The feature requires a valid Snowflake configuration
- Large datasets may take longer to export
- Real-time synchronization is not supported

## Future Enhancements

- Real-time change data capture (CDC) for immediate updates
- Advanced filtering options for selective exports
- Custom transformation rules for specific data needs
- Multi-tenant export scheduling for improved performance 