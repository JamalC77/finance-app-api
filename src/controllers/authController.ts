import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../models/prisma';
import { env } from '../utils/env';

/**
 * Register a new user
 * @route POST /api/auth/register
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide name, email, and password' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create default organization for the user
    const organization = await prisma.organization.create({
      data: {
        name: `${name}'s Organization`,
      }
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
        role: 'ADMIN',
        organizationId: organization.id,
      }
    });

    // Create JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        organizationId: user.organizationId 
      },
      env.JWT_SECRET,
      { expiresIn: '1d' }
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
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Server error during registration' });
  }
};

/**
 * Login a user
 * @route POST /api/auth/login
 */
export const login = async (req: Request, res: Response) => {
  try {
    // Enhanced logging for debugging
    console.log('=====================================================');
    console.log('Login request received at:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body type:', typeof req.body);
    console.log('Body is object:', req.body !== null && typeof req.body === 'object');
    console.log('Body keys:', req.body ? Object.keys(req.body) : 'No body');
    console.log('Raw body:', JSON.stringify(req.body, null, 2));
    console.log('=====================================================');

    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      console.log('❌ Login failed: Missing email or password');
      return res.status(400)
        .header('Access-Control-Allow-Origin', '*')
        .json({ error: 'Please provide email and password' });
    }

    console.log('👤 Attempting login for email:', email);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      console.log('❌ Login failed: User not found');
      return res.status(400)
        .header('Access-Control-Allow-Origin', '*')
        .json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('❌ Login failed: Invalid password');
      return res.status(400)
        .header('Access-Control-Allow-Origin', '*')
        .json({ error: 'Invalid credentials' });
    }

    console.log('✅ Login successful for user:', user.email);

    // Create JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        organizationId: user.organizationId 
      },
      env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Set explicit CORS headers
    res.header('Access-Control-Allow-Origin', '*');

    // Return user (without password) and token
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500)
      .header('Access-Control-Allow-Origin', '*')
      .json({ error: 'Server error during login' });
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
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
    console.error('Get user profile error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}; 