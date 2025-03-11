# Finance App API

This is the backend API for the Finance App, built with Express.js and TypeScript.

## Project Structure

```
finance-app-api/
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
- MongoDB (optional, depending on your setup)

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file with your actual API keys and secrets

### Development

Start the development server:

```
npm run dev
```

The server will run on http://localhost:5000 by default.

### Building for Production

Build the application:

```
npm run build
```

This will create a `dist` directory with the compiled JavaScript.

### Deployment

You can use the deployment script to prepare the application for deployment:

```
bash scripts/deploy.sh
```

This will create a deployment package in the `deploy` directory.

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