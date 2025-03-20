import { Router } from "express";
import * as subscriptionController from "../controllers/subscriptionController";
import { auth } from "../middleware/authMiddleware";

const router = Router();

/**
 * @route   GET /api/subscriptions
 * @desc    Get current user's subscription information
 * @access  Private
 */
router.get("/", auth, subscriptionController.getUserSubscription);

/**
 * @route   POST /api/subscriptions/webhook
 * @desc    Handle Stripe subscription webhook events
 * @access  Public (secured by Stripe signature verification)
 */
router.post("/webhook", subscriptionController.handleStripeWebhook);

export default router;
