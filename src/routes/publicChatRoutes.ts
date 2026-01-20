import { Router } from 'express';
import * as publicChatController from '../controllers/publicChatController';
import { chatRateLimiter } from '../middleware/rateLimitMiddleware';

const router = Router();

/**
 * @route   POST /api/public/chat/start
 * @desc    Start a new chat session or resume an existing one
 * @access  Public
 */
router.post('/start', chatRateLimiter, publicChatController.startSession);

/**
 * @route   POST /api/public/chat/message
 * @desc    Send a message in an existing chat session
 * @access  Public
 */
router.post('/message', chatRateLimiter, publicChatController.sendMessage);

/**
 * @route   POST /api/public/chat/calendly-clicked
 * @desc    Track when a user clicks the Calendly booking link
 * @access  Public
 */
router.post('/calendly-clicked', publicChatController.trackCalendlyClick);

/**
 * @route   GET /api/public/chat/calendly-url
 * @desc    Get the Calendly booking URL
 * @access  Public
 */
router.get('/calendly-url', publicChatController.getCalendlyUrl);

/**
 * @route   POST /api/public/chat/capture-lead
 * @desc    Capture lead information (email, name, company)
 * @access  Public
 */
router.post('/capture-lead', publicChatController.captureLeadInfo);

export default router;
