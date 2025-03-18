# Railway CORS Configuration Instructions

Since we're having issues with the CLI, follow these steps to manually update your CORS settings on Railway:

1. Log in to the [Railway Dashboard](https://railway.app/dashboard)

2. Select your project: `cfo-line-api`

3. Go to the "Variables" tab

4. Add or update the following environment variables:

   - `FRONTEND_URL` = `https://thecfoline.com`

5. Click "Deploy" to apply the changes

6. After deployment, your API should now accept CORS requests from:
   - `https://thecfoline.com` (production frontend)
   - `http://localhost:3000` (local development)
   - `https://cfo-line-api.up.railway.app` (Railway API URL)

## Testing the Configuration

1. With your Railway API running, test the connection from your local frontend:

```bash
cd ../finance-app
npm run dev
```

2. Open your browser to: `http://localhost:3000/api-connectivity-test`

3. Check if the API calls succeed without CORS errors

## Troubleshooting

If you still experience CORS issues:

1. Check the browser console for specific error messages
2. Verify that the API is responding with the proper CORS headers:
   - `Access-Control-Allow-Origin: http://localhost:3000`
   - `Access-Control-Allow-Credentials: true`
3. Try accessing other endpoints like `/health` or `/api/cors-test` 