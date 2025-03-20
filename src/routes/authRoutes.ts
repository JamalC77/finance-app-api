import { Router } from "express";
import * as authController from "../controllers/authController";
import { auth } from "../middleware/authMiddleware";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post("/register", asyncHandler(authController.register));

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 */
router.post("/login", asyncHandler(authController.login));

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get("/me", auth, asyncHandler(authController.getMe));

/**
 * @route   POST /api/auth/request-reset
 * @desc    Request a password reset link
 * @access  Public
 */
router.post("/request-reset", asyncHandler(authController.requestPasswordReset));

/**
 * @route   GET /api/auth/verify-reset-token/:token
 * @desc    Verify if a password reset token is valid
 * @access  Public
 */
router.get("/verify-reset-token/:token", asyncHandler(authController.verifyResetToken));

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset user password using a valid token
 * @access  Public
 */
router.post("/reset-password", asyncHandler(authController.resetPassword));

export default router;
