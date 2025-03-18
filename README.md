# CFO Line API

This is the backend API for CFO Line, providing the necessary endpoints for the frontend and handling data processing.

## Project Structure

```
cfo-line-api/
├── src/
│   ├── controllers/    # Request handlers
│   ├── services/       # Business logic and external service integrations
│   ├── models/         # Data models
│   ├── routes/         # API route definitions
│   ├── middleware/     # Express middleware
│   ├── utils/          # Utility functions
│   └── index.ts        # Main application entry point
├── config/             # Configuration files
├── scripts/            # Deployment and utility scripts
├── dist/               # Compiled JavaScript (generated)
└── .env.example        # Example environment variables
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- PostgreSQL database

### Installation

1. Clone the repository
2. Navigate to the API directory:
   ```
   cd finance-app-api
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Set up environment variables:
   ```
   cp .env.example .env
   ```
5. Edit the `.env` file with your actual database connection string and API keys

### Running the API

For development:
```
npm run dev
```

For production:
```
npm run build
npm start
```

## Setting Up QuickBooks Integration

### Creating a QuickBooks Developer Account

1. Sign up for a developer account at [QuickBooks Developer Portal](https://developer.intuit.com/)
2. Create a new app:
   - Go to Dashboard → Create an app
   - Select API type: "Accounting"
   - Development type: "Web app"
   - Enter app name (e.g., "Finance App")
3. Configure OAuth Settings:
   - Add Redirect URI: `https://your-api-url.com/api/quickbooks/callback` (update for your deployment)
   - Add development URI: `http://localhost:5000/api/quickbooks/callback` (for local testing)
4. Note your Client ID and Client Secret

### Environment Variables for QuickBooks

Add the following to your `.env` file:

```
# QuickBooks Integration
QUICKBOOKS_CLIENT_ID=your_quickbooks_client_id
QUICKBOOKS_CLIENT_SECRET=your_quickbooks_client_secret
QUICKBOOKS_REDIRECT_URI=https://your-api-url.com/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox # or production
QUICKBOOKS_API_BASE_URL=https://sandbox-quickbooks.api.intuit.com/v3 # or production URL

# Encryption (for storing tokens securely)
ENCRYPTION_KEY=your_32_character_encryption_key
ENCRYPTION_IV=your_16_character_encryption_iv
```

### Running Scheduled Sync

To manually run the scheduled sync job:

```
npm run quickbooks:sync
```

For production, set up a cron job to run the sync at regular intervals:

```
# Run every hour
0 * * * * cd /path/to/finance-app-api && npm run quickbooks:sync >> logs/quickbooks-sync.log 2>&1
```

## API Documentation

The API provides the following endpoints:

### Authentication
- `/api/auth/register` - Register a new user
- `/api/auth/login` - Login an existing user
- `/api/auth/me` - Get current user info

### QuickBooks Integration
- `/api/quickbooks/auth/url` - Get QuickBooks authorization URL
- `/api/quickbooks/callback` - OAuth callback handler
- `/api/quickbooks/connection` - Get connection status
- `/api/quickbooks/connection/settings` - Update connection settings
- `/api/quickbooks/connection` (DELETE) - Disconnect from QuickBooks
- `/api/quickbooks/sync` - Trigger a full sync
- `/api/quickbooks/sync/status` - Get sync status
- `/api/quickbooks/sync/:entityType` - Sync a specific entity type
- `/api/quickbooks/sync/history` - Get sync history

### Other Endpoints
- `/api/transactions` - CRUD for transactions
- `/api/invoices` - CRUD for invoices
- `/api/expenses` - CRUD for expenses
- `/api/contacts` - CRUD for contacts
- `/api/accounts` - CRUD for accounts

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for instructions on deploying the API.

## API Endpoints

### Plaid

- `POST /api/plaid/create-link-token` - Create a link token for Plaid Link
- `POST /api/plaid/exchange-public-token` - Exchange public token for access token
- `POST /api/plaid/accounts` - Get accounts for a user
- `POST /api/plaid/transactions` - Get transactions for a user

## Environment Variables

The application uses environment variables for configuration. See `.env.example` for a list of required variables.

## Security

- All sensitive information is stored in environment variables
- JWT authentication is used to protect API endpoints
- CORS is configured to only allow requests from the frontend

## Connecting with the Frontend

The frontend should be configured to connect to this API using the `NEXT_PUBLIC_API_URL` environment variable.

Example:

```
# In the frontend .env file
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## CORS Configuration

The API includes CORS middleware to handle cross-origin requests. The configuration supports both local development and production environments.

### Local Development

When running locally, the API will accept requests from:
- http://localhost:3000
- https://localhost:3000
- http://127.0.0.1:3000

### Production Deployment

For production environments, you need to set the `FRONTEND_URL` environment variable to your frontend URL. This is especially important for Railway deployments.

Example:
```
FRONTEND_URL=https://finance-app-production.vercel.app
```

The API will then include this URL in the list of allowed origins for CORS.

## Railway Deployment

To deploy to Railway with the correct CORS configuration:

1. Make sure you have the Railway CLI installed:
   ```
   npm install -g @railway/cli
   ```

2. Use the provided deployment script:
   ```
   ./railway-deploy-script.sh
   ```

3. Or manually set the environment variables:
   ```
   railway login
   railway variables set FRONTEND_URL=https://your-frontend-domain.com
   railway up
   ```

4. Replace `https://your-frontend-domain.com` with your actual frontend URL.

## Troubleshooting CORS Issues

If you're experiencing CORS errors:

1. Check that your frontend's origin matches one of the allowed origins in `src/index.ts`
2. Verify that the `FRONTEND_URL` environment variable is set correctly in Railway
3. Use the API Connectivity Test page at `/api-connectivity-test` in the frontend to debug connections
4. Check browser console for specific CORS error messages 