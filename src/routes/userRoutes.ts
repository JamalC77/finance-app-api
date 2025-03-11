import express from 'express';
import { auth } from '../middleware/authMiddleware';
import { prisma } from '../models/prisma';

// Import controllers (these would be implemented in a real app)
// For now we'll create placeholder functions
const router = express.Router();

// GET /api/users - Get all users (admin only)
router.get('/', auth, async (req, res) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Not authorized to access this resource' });
  }
  
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId }
    });
    
    // Process the users to format metadata and remove sensitive information
    const processedUsers = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return {
        ...userWithoutPassword,
        metadata: userWithoutPassword.metadata ? JSON.parse(userWithoutPassword.metadata as string) : {}
      };
    });
    
    res.status(200).json({ users: processedUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/me - Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { organization: true }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;
    
    // Parse the metadata back to an object for the response
    const responseUser = {
      ...userWithoutPassword,
      metadata: userWithoutPassword.metadata ? JSON.parse(userWithoutPassword.metadata as string) : {}
    };
    
    res.status(200).json({ 
      user: responseUser
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /api/users/me - Update current user profile
router.put('/me', auth, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get all fields from the request body
    const { 
      // Core user fields
      name, 
      email,
      
      // Extended profile fields
      firstName,
      lastName,
      phone,
      jobTitle,
      company,
      bio,
      address,
      city,
      state,
      zipCode,
      country,
      website,
      twitter,
      linkedin,
      
      // Preferences
      dateFormat,
      timeZone,
      twoFactorEnabled,
      emailNotifications,
      appNotifications,
      
      // Security settings
      password, // This would require separate handling for security
      newPassword // This would require separate handling for security
    } = req.body;
    
    // Verify the user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Prepare the update data for core User model
    const updateData: any = {};
    
    // Only update fields that were provided
    if (name !== undefined) updateData.name = name;
    if (email !== undefined && email !== existingUser.email) {
      // Check if the email is already in use
      const emailExists = await prisma.user.findUnique({
        where: { email }
      });
      
      if (emailExists && emailExists.id !== req.user.id) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      
      updateData.email = email;
    }
    
    // For a real application, we would:
    // 1. Create a UserProfile model in Prisma to store the extended fields
    // 2. Update or create the UserProfile when user updates their profile
    
    // For now, we'll store this information in a metadata field
    // First, retrieve any existing metadata
    const existingMetadata = existingUser.metadata ? JSON.parse(existingUser.metadata as string) : {};
    
    // Create a new metadata object with all the profile fields
    const profileMetadata = {
      ...existingMetadata,
      profile: {
        ...(existingMetadata.profile || {}),
        firstName,
        lastName,
        phone,
        jobTitle,
        company,
        bio,
        address,
        city,
        state,
        zipCode,
        country,
        website,
        twitter,
        linkedin,
      },
      preferences: {
        ...(existingMetadata.preferences || {}),
        dateFormat,
        timeZone,
        twoFactorEnabled,
        emailNotifications,
        appNotifications,
      }
    };
    
    // Clean up the metadata by removing undefined values
    Object.keys(profileMetadata.profile).forEach(key => {
      if (profileMetadata.profile[key] === undefined) {
        delete profileMetadata.profile[key];
      }
    });
    
    Object.keys(profileMetadata.preferences).forEach(key => {
      if (profileMetadata.preferences[key] === undefined) {
        delete profileMetadata.preferences[key];
      }
    });
    
    // Add the metadata to the update data
    updateData.metadata = JSON.stringify(profileMetadata);
    
    // Handle password update
    if (newPassword) {
      // This would involve verifying the current password, hashing the new password, etc.
      // For now, we'll skip actual password handling for security reasons
      console.log('Password update requested but not implemented in this demo');
    }
    
    console.log('Updating user with data:', updateData);
    
    // Update the user in the database
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      include: { organization: true }
    });
    
    // Remove sensitive information
    const { password: pwd, ...userWithoutPassword } = updatedUser;
    
    // Parse the metadata back to an object for the response
    const responseUser = {
      ...userWithoutPassword,
      metadata: userWithoutPassword.metadata ? JSON.parse(userWithoutPassword.metadata as string) : {}
    };
    
    console.log('User updated successfully:', responseUser);
    
    res.status(200).json({ 
      message: 'Profile updated successfully',
      user: responseUser
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

// GET /api/users/:id - Get user by ID (admin only)
router.get('/:id', auth, async (req, res) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Not authorized to access this resource' });
  }
  
  try {
    const userId = req.params.id;
    
    const user = await prisma.user.findUnique({
      where: { 
        id: userId,
        organizationId: req.user.organizationId // Ensure user belongs to same org
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;
    
    // Parse the metadata back to an object for the response
    const responseUser = {
      ...userWithoutPassword,
      metadata: userWithoutPassword.metadata ? JSON.parse(userWithoutPassword.metadata as string) : {}
    };
    
    res.status(200).json({ user: responseUser });
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router; 