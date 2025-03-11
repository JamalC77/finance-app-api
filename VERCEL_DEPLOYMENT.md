# Deploying the Finance App API to Vercel

This guide walks you through deploying your Finance App API to Vercel.

## Prerequisites

- A Vercel account (you can sign up at [vercel.com](https://vercel.com))
- Vercel CLI installed: `npm install -g vercel`
- Your project is properly set up with `vercel.json` (already included in this repo)

## Deployment Steps

### 1. Login to Vercel

```bash
vercel login
```

### 2. Deploy to Vercel

For development/preview deployment:

```bash
npm run deploy:vercel
```

For production deployment:

```bash
npm run deploy:production
```

Alternatively, you can use:

```bash
vercel
# or for production
vercel --prod
```

### 3. Set Environment Variables

After your first deployment, you'll need to set up environment variables in the Vercel dashboard:

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your project
3. Click on the "Settings" tab
4. Select "Environment Variables"
5. Add all the required environment variables from your `.env.example` file

### 4. Configure Frontend to Use Vercel API URL

Update your frontend's `.env` file to point to your Vercel deployment:

```
NEXT_PUBLIC_API_URL=https://your-api-name.vercel.app
```

## Important Considerations for Vercel Deployment

### Serverless Architecture

Vercel uses a serverless architecture, which means:

- Your API has cold starts (first request after inactivity may be slower)
- Long-running operations should be avoided
- The server doesn't maintain state between requests

### Limitations

- Execution timeout: Functions time out after 10 seconds in the free plan
- Request size: Limited to 4.5MB
- Response size: Limited to 4.5MB
- Statelessness: No file system persistence between requests

### Best Practices

- Keep your functions lightweight and fast
- Use database services for persistent storage
- Set appropriate timeouts for external API calls
- Consider using Vercel Edge Functions for global distribution

## Monitoring

You can monitor your API's performance in the Vercel dashboard:

1. Go to your Vercel dashboard
2. Select your project
3. Click on the "Analytics" tab to view performance metrics

## Troubleshooting

If you encounter issues:

1. Check the Vercel deployment logs in the dashboard
2. Verify your environment variables are correctly set
3. Make sure your code is compatible with serverless architecture
4. Test locally with `vercel dev` before deploying 