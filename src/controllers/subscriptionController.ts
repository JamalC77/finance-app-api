import { Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "../models/prisma";

// Initialize Stripe with secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24.acacia",
});

/**
 * Get the current user's subscription information
 */
export const getUserSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        planType: true,
        planExpiresAt: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      subscription: {
        planType: user.planType,
        planExpiresAt: user.planExpiresAt,
        isActive: user.planType !== "FREE" && (!user.planExpiresAt || new Date(user.planExpiresAt) > new Date()),
      },
    });
  } catch (error: any) {
    console.error("Error in getUserSubscription controller:", error);
    return res.status(500).json({
      error: "Failed to retrieve subscription information",
      message: error.message,
    });
  }
};

/**
 * Handle Stripe subscription webhook
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret as string);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object);
      break;

    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return 200 success response to acknowledge receipt of the event
  res.json({ received: true });
};

/**
 * Handle completed checkout session
 */
const handleCheckoutSessionCompleted = async (session: Stripe.Checkout.Session) => {
  // Get the client_reference_id which contains the user ID
  const userId = session.client_reference_id;

  if (!userId) {
    console.error("Missing client_reference_id in checkout session");
    return;
  }

  try {
    // Get the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error("User not found:", userId);
      return;
    }

    // Get subscription information
    let subscriptionId: string | null = null;
    let subscriptionData: Stripe.Subscription | null = null;
    let customerId = session.customer as string;

    // If the session has a subscription, get its details
    if (session.subscription) {
      subscriptionId = session.subscription as string;
      subscriptionData = await stripe.subscriptions.retrieve(subscriptionId);
    }

    // Determine the plan type based on the purchased product
    let planType = "BASIC"; // Default to BASIC
    let planExpiresAt: Date | null = null;

    if (subscriptionData) {
      // Calculate expiration date from subscription period
      const currentPeriodEnd = new Date(subscriptionData.current_period_end * 1000);
      planExpiresAt = currentPeriodEnd;
    }

    // Update the user's subscription information
    await prisma.user.update({
      where: { id: userId },
      data: {
        planType: planType as any,
        planExpiresAt,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      },
    });

    console.log(`Updated subscription for user ${userId} to ${planType}`);
  } catch (error: any) {
    console.error("Error processing checkout session:", error);
  }
};

/**
 * Handle subscription updates
 */
const handleSubscriptionUpdated = async (subscription: Stripe.Subscription) => {
  try {
    // Find the user with this subscription ID
    const user = await prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!user) {
      console.error("No user found with subscription ID:", subscription.id);
      return;
    }

    // Update subscription details
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    let planType = user.planType; // Keep existing plan by default

    // Update the user's subscription information
    await prisma.user.update({
      where: { id: user.id },
      data: {
        planType: planType as any,
        planExpiresAt: currentPeriodEnd,
      },
    });

    console.log(`Updated subscription period for user ${user.id} to ${currentPeriodEnd}`);
  } catch (error: any) {
    console.error("Error processing subscription update:", error);
  }
};

/**
 * Handle subscription deletion/cancellation
 */
const handleSubscriptionDeleted = async (subscription: Stripe.Subscription) => {
  try {
    // Find the user with this subscription ID
    const user = await prisma.user.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!user) {
      console.error("No user found with subscription ID:", subscription.id);
      return;
    }

    // Update the user's subscription to FREE after current period
    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Keep planType and planExpiresAt until expiration
        // Stripe subscriptions remain active until the end of the period
      },
    });

    console.log(`Marked subscription ${subscription.id} for cancellation at period end`);
  } catch (error: any) {
    console.error("Error processing subscription deletion:", error);
  }
};
