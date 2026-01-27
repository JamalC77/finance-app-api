import { Router } from 'express';
import * as prospectController from '../controllers/prospectController';
import { chatRateLimiter } from '../middleware/rateLimitMiddleware';

const router = Router();

/**
 * @route   GET /api/public/prospect/:slug
 * @desc    Get prospect page data (public info only)
 * @access  Public
 */
router.get('/:slug', prospectController.getProspectPageData);

/**
 * @route   POST /api/public/prospect/:slug/view
 * @desc    Track page view for a prospect page
 * @access  Public
 */
router.post('/:slug/view', prospectController.trackPageView);

/**
 * @route   POST /api/public/prospect/:slug/chat/start
 * @desc    Start a prospect-specific chat session
 * @access  Public
 */
router.post('/:slug/chat/start', chatRateLimiter, prospectController.startProspectChat);

/**
 * @route   POST /api/public/prospect/:slug/chat/message
 * @desc    Send a message in a prospect chat session
 * @access  Public
 */
router.post('/:slug/chat/message', chatRateLimiter, prospectController.sendProspectMessage);

/**
 * @route   POST /api/public/prospect/:slug/cta-click
 * @desc    Track CTA click on a prospect page
 * @access  Public
 */
router.post('/:slug/cta-click', prospectController.trackCtaClick);

export default router;
