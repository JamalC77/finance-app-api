# QuickBooks Integration Guide

This document provides an overview of the QuickBooks integration with the Finance App, including setup instructions, architecture details, and troubleshooting tips.

## Overview

The Finance App integrates with QuickBooks Online to provide automatic synchronization of accounting data and generate financial insights. The integration uses the QuickBooks API to fetch data such as accounts, contacts, transactions, and invoices, and stores them in the application's database. The data is then processed using Google Cloud services to generate actionable financial insights.

## Features

- **OAuth 2.0 Authentication**: Secure connection to QuickBooks accounts
- **Automatic Data Synchronization**: Regular syncing of accounting data based on configurable frequency
- **Entity Mapping**: Bidirectional mapping between QuickBooks entities and application entities
- **Financial Insights**: Automated generation of financial insights based on accounting data
- **Analytics**: Advanced data analysis using Google BigQuery

## Setup Instructions

### Prerequisites

1. A QuickBooks Online account
2. A Google Cloud Platform account
3. Finance App deployed and running

### QuickBooks Developer Setup

1. Create a developer account at [QuickBooks Developer Portal](https://developer.intuit.com/)
2. Create a new app in the developer dashboard
3. Configure the app with the following settings:
   - **App Name**: Finance App
   - **App Type**: Web app
   - **Scopes**: Accounting
   - **Redirect URIs**: `https://your-app-domain.com/api/quickbooks/callback`
4. Note the Client ID and Client Secret

### Environment Configuration

Add the following environment variables to your `.env` file:

```
# QuickBooks Integration
QUICKBOOKS_CLIENT_ID=your_quickbooks_client_id
QUICKBOOKS_CLIENT_SECRET=your_quickbooks_client_secret
QUICKBOOKS_REDIRECT_URI=https://your-app-domain.com/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production # or sandbox for testing
QUICKBOOKS_API_BASE_URL=https://quickbooks.api.intuit.com/v3 # or sandbox URL

# Google Cloud
GOOGLE_CLOUD_PROJECT_ID=your_google_cloud_project_id
GOOGLE_CLOUD_KEY_FILE=./config/google-cloud-key.json
GOOGLE_CLOUD_REGION=us-central1
BIGQUERY_DATASET=finance_analytics
STORAGE_BUCKET=finance-app-analytics

# Encryption
ENCRYPTION_KEY=your_32_character_encryption_key
ENCRYPTION_IV=your_16_character_encryption_iv
```

### Google Cloud Setup

1. Create a Google Cloud project
2. Enable the BigQuery API
3. Create a service account with BigQuery Admin permissions
4. Download the service account key and save it as `./config/google-cloud-key.json`

### Database Migration

Run the Prisma migration to add the QuickBooks integration tables:

```bash
npx prisma migrate dev --name add-quickbooks-integration
```

### Scheduled Jobs

Set up a cron job to run the scheduled sync script:

```bash
# Run every hour
0 * * * * cd /path/to/finance-app-api && npx ts-node src/scripts/scheduledSync.ts >> logs/quickbooks-sync.log 2>&1
```

## Architecture

### Components

1. **Authentication Service**: Handles OAuth 2.0 flow with QuickBooks
2. **API Client**: Makes requests to the QuickBooks API
3. **Synchronization Services**: Entity-specific services for syncing data
4. **Mapping Services**: Map QuickBooks entities to application entities
5. **BigQuery Service**: Exports and analyzes data in Google BigQuery
6. **Insights Service**: Generates financial insights from the data

### Data Flow

1. User connects to QuickBooks via OAuth
2. Application receives access token and stores it securely
3. Scheduled job or manual trigger initiates data sync
4. API client fetches data from QuickBooks
5. Data is transformed and stored in application database
6. Data is exported to BigQuery for analysis
7. Insights are generated and presented to the user

## Troubleshooting

### Common Issues

#### Connection Failures

- Verify that the QuickBooks API credentials are correct
- Check that the redirect URI is properly configured
- Ensure the OAuth scopes are set correctly

#### Sync Errors

- Check the sync logs for specific error messages
- Verify that the QuickBooks account has the necessary permissions
- Check for API rate limiting issues

#### Insight Generation Failures

- Verify that data is being exported to BigQuery correctly
- Check the BigQuery dataset and table permissions
- Review the insight generation logs for errors

### Logs

Sync and error logs can be found in the following locations:

- **Sync Logs**: `/path/to/finance-app-api/logs/quickbooks-sync.log`
- **Error Logs**: Database `sync_logs` table

## API Reference

### Endpoints

- `GET /api/quickbooks/auth/url`: Get the QuickBooks authorization URL
- `GET /api/quickbooks/callback`: OAuth callback handler
- `GET /api/quickbooks/connection`: Get connection status
- `PUT /api/quickbooks/connection/settings`: Update connection settings
- `DELETE /api/quickbooks/connection`: Disconnect from QuickBooks
- `POST /api/quickbooks/sync`: Trigger a full sync
- `GET /api/quickbooks/sync/status`: Get sync status
- `POST /api/quickbooks/sync/:entityType`: Sync a specific entity type
- `GET /api/quickbooks/sync/history`: Get sync history

### Insights Endpoints

- `GET /api/insights`: Get all insights
- `POST /api/insights/generate`: Generate new insights
- `GET /api/insights/:insightId`: Get a specific insight
- `PATCH /api/insights/:insightId/read`: Mark an insight as read
- `PATCH /api/insights/all/read`: Mark all insights as read
- `GET /api/insights/analysis/cashflow`: Get cash flow analysis
- `GET /api/insights/analysis/expenses`: Get expense trend analysis
- `GET /api/insights/analysis/profitability`: Get profitability analysis
- `POST /api/insights/export`: Export data to BigQuery
- `POST /api/insights/setup-analytics`: Initialize BigQuery for an organization

## Security Considerations

- OAuth tokens are encrypted in the database
- HTTPS is required for all API calls
- API rate limiting is implemented to prevent abuse
- Access to insights is restricted to authorized users

## Best Practices

- Implement proper error handling in the frontend
- Set up monitoring for sync jobs
- Regularly backup the database
- Review and update the QuickBooks integration as API changes occur 