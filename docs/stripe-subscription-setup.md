# Stripe Subscription Integration

This document explains how to set up Stripe for subscription handling in the Finance App.

## Prerequisites

1. Stripe account (you can use a test account for development)
2. API keys from Stripe Dashboard

## Environment Variables

Set the following environment variables in your `.env` file:

```
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=your-stripe-subscription-webhook-secret
```

## Stripe Webhook Setup

You need to set up two webhooks in your Stripe dashboard:

### 1. Payment Webhook (existing)

- Endpoint: `https://your-api-domain.com/api/payments/webhook`
- Events to subscribe to:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`

### 2. Subscription Webhook (new)

- Endpoint: `https://your-api-domain.com/api/subscriptions/webhook`
- Events to subscribe to:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

## How it Works

1. **User Initiates Subscription**: When an authenticated user clicks the "Activate Plan" button in the navbar, they're directed to a Stripe Checkout page.

2. **Tracking User Info**: The user's ID is passed to Stripe as the `client_reference_id` parameter to track which user purchased the subscription.

3. **Stripe Checkout**: User enters payment details and completes checkout on Stripe's hosted page.

4. **Webhook Notification**: After successful payment, Stripe sends a `checkout.session.completed` event to our subscription webhook endpoint.

5. **User Update**: The API receives the webhook, verifies the signature, and updates the user's subscription information (planType, expiration date, etc.).

## Testing

You can test the subscription process using the Stripe test mode:

1. Use the test payment URL (`https://buy.stripe.com/test_eVaaGP830d5g4uI144`) with your integration
2. Use Stripe's test card details (e.g., 4242 4242 4242 4242) for payment
3. Check the webhook events in the Stripe dashboard
4. Verify user subscription data was updated correctly in the database

## Accessing Protected Features

Protected features require an active subscription. These are enforced using the `requireSubscription` middleware.

```typescript
// Example route that requires a subscription
router.get("/premium-feature", auth, requireSubscription(["BASIC", "PREMIUM", "ENTERPRISE"]), premiumFeatureController);
```

This will restrict access to users with at least a BASIC subscription plan that isn't expired.
