import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../models/prisma";
import { env } from "../utils/env";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../services/emailService";

/**
 * Register a new user
 * @route POST /api/auth/register
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Please provide name, email, and password" });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User with this email already exists" });
    }

    // Create default organization for the user
    const organization = await prisma.organization.create({
      data: {
        name: `${name}'s Organization`,
      },
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "ADMIN",
        organizationId: organization.id,
      },
    });

    // Create JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
      env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Return user (without password) and token
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Server error during registration" });
  }
};

/**
 * Login a user
 * @route POST /api/auth/login
 */
export const login = async (req: Request, res: Response) => {
  try {
    // Enhanced logging for debugging
    console.log("=====================================================");
    console.log("Login request received at:", new Date().toISOString());
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body type:", typeof req.body);
    console.log("Body is object:", req.body !== null && typeof req.body === "object");
    console.log("Body keys:", req.body ? Object.keys(req.body) : "No body");
    console.log("Raw body:", JSON.stringify(req.body, null, 2));
    console.log("=====================================================");

    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      console.log("❌ Login failed: Missing email or password");
      return res.status(400).header("Access-Control-Allow-Origin", "*").json({ error: "Please provide email and password" });
    }

    console.log("👤 Attempting login for email:", email);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log("❌ Login failed: User not found");
      return res.status(400).header("Access-Control-Allow-Origin", "*").json({ error: "Invalid credentials" });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Login failed: Invalid password");
      return res.status(400).header("Access-Control-Allow-Origin", "*").json({ error: "Invalid credentials" });
    }

    console.log("✅ Login successful for user:", user.email);

    // Create JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
      env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Set explicit CORS headers
    res.header("Access-Control-Allow-Origin", "*");

    // Return user (without password) and token
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    return res.status(500).header("Access-Control-Allow-Origin", "*").json({ error: "Server error during login" });
  }
};

/**
 * Get current user profile
 * @route GET /api/auth/me
 */
export const getMe = async (req: Request, res: Response) => {
  try {
    // User will be attached by the auth middleware
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return user without password
    return res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

/**
 * Request password reset
 * @route POST /api/auth/request-reset
 */
export const requestPasswordReset = async (req: Request, res: Response) => {
  try {
    console.log("=====================================================");
    console.log("Password reset request received at:", new Date().toISOString());

    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({ error: "Please provide your email address" });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // For security reasons, don't reveal if the user exists
    if (!user) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.status(200).json({
        message: "If your email is registered, you will receive a password reset link shortly",
      });
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");

    // Set expiration to 30 minutes from now
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    // Delete any existing reset tokens for this user for security
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // Create a new token in the database
    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    // Generate reset link
    const resetLink = `${env.FRONTEND_URL}/auth/reset-password?token=${token}`;

    // Send email with reset link
    const emailSent = await sendPasswordResetEmail(user.email, resetLink, user.name || "User");

    if (!emailSent) {
      console.error("Failed to send password reset email");
      return res.status(500).json({ error: "Failed to send reset email. Please try again later." });
    }

    console.log(`Password reset link sent successfully to ${email}`);

    // Respond with success message
    return res.status(200).json({
      message: "If your email is registered, you will receive a password reset link shortly",
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    return res.status(500).json({ error: "Server error during password reset request" });
  }
};

/**
 * Verify reset token
 * @route GET /api/auth/verify-reset-token/:token
 */
export const verifyResetToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // Find the token in the database
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    // Check if token exists and is not expired
    if (!resetToken || resetToken.expiresAt < new Date() || resetToken.usedAt) {
      return res.status(400).json({
        error: "Invalid or expired reset token. Please request a new password reset link.",
      });
    }

    // Return success
    return res.status(200).json({
      message: "Token is valid",
      email: resetToken.user.email,
    });
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(500).json({ error: "Server error during token verification" });
  }
};

/**
 * Reset password
 * @route POST /api/auth/reset-password
 */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    // Validate input
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    // Password strength validation
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" });
    }

    // Find the token in the database
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    // Check if token exists, is not used, and is not expired
    if (!resetToken || resetToken.expiresAt < new Date() || resetToken.usedAt) {
      return res.status(400).json({
        error: "Invalid or expired reset token. Please request a new password reset link.",
      });
    }

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update the user's password and mark token as used
    await prisma.$transaction([
      // Update user password
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      // Mark token as used
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    console.log(`Password reset successfully for user ID: ${resetToken.userId}`);

    // Return success
    return res.status(200).json({ message: "Password has been reset successfully. You can now log in with your new password." });
  } catch (error) {
    console.error("Password reset error:", error);
    return res.status(500).json({ error: "Server error during password reset" });
  }
};
