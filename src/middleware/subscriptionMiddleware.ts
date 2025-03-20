import { Request, Response, NextFunction } from "express";
import { prisma } from "../models/prisma";

/**
 * Middleware to check if user has an active subscription at or above the required level
 * @param requiredPlanTypes Array of plan types that have access (in order of increasing privilege)
 */
export const requireSubscription = (requiredPlanTypes: string[] = ["BASIC", "PREMIUM", "ENTERPRISE"]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Get user with subscription info
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          planType: true,
          planExpiresAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if the user's plan type is in the required plans
      if (!requiredPlanTypes.includes(user.planType)) {
        return res.status(403).json({
          error: "Subscription required",
          message: "This feature requires a paid subscription",
          requiredPlans: requiredPlanTypes,
        });
      }

      // Check if the subscription has expired
      if (user.planExpiresAt && new Date(user.planExpiresAt) < new Date()) {
        return res.status(403).json({
          error: "Subscription expired",
          message: "Your subscription has expired",
          expiredAt: user.planExpiresAt,
        });
      }

      // If checks pass, proceed to the next middleware/route handler
      next();
    } catch (error: any) {
      console.error("Error checking subscription:", error);
      return res.status(500).json({
        error: "Server error",
        message: error.message,
      });
    }
  };
};
