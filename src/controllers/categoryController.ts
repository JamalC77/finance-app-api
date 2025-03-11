import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all categories for the organization
export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }

    // Get all categories for the organization
    const categories = await prisma.taxCategory.findMany({
      where: {
        organizationId
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    return res.status(200).json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

// Get a specific category by ID
export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    const category = await prisma.taxCategory.findFirst({
      where: {
        id,
        organizationId
      }
    });
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    return res.status(200).json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    return res.status(500).json({ error: 'Failed to fetch category' });
  }
};

// Create a new category
export const createCategory = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    const { name, description, rate } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    // Check if category with the same name already exists
    const existingCategory = await prisma.taxCategory.findFirst({
      where: {
        name,
        organizationId
      }
    });
    
    if (existingCategory) {
      return res.status(400).json({ error: 'A category with this name already exists' });
    }
    
    // Create the category
    const category = await prisma.taxCategory.create({
      data: {
        name,
        description: description || null,
        rate: rate !== undefined ? parseFloat(rate.toString()) : 0,
        organizationId
      }
    });
    
    return res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    return res.status(500).json({ error: 'Failed to create category' });
  }
};

// Update an existing category
export const updateCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    // Check if category exists and belongs to the organization
    const existingCategory = await prisma.taxCategory.findFirst({
      where: {
        id,
        organizationId
      }
    });
    
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const { name, description, rate, isActive } = req.body;
    
    // If name is changing, check for duplicates
    if (name && name !== existingCategory.name) {
      const duplicateCategory = await prisma.taxCategory.findFirst({
        where: {
          name,
          organizationId,
          id: { not: id }
        }
      });
      
      if (duplicateCategory) {
        return res.status(400).json({ error: 'A category with this name already exists' });
      }
    }
    
    // Update the category
    const category = await prisma.taxCategory.update({
      where: { id },
      data: {
        name: name || existingCategory.name,
        description: description !== undefined ? description : existingCategory.description,
        rate: rate !== undefined ? parseFloat(rate.toString()) : existingCategory.rate,
        isActive: isActive !== undefined ? isActive : existingCategory.isActive
      }
    });
    
    return res.status(200).json(category);
  } catch (error) {
    console.error('Error updating category:', error);
    return res.status(500).json({ error: 'Failed to update category' });
  }
};

// Delete a category
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    // Check if category exists and belongs to the organization
    const category = await prisma.taxCategory.findFirst({
      where: {
        id,
        organizationId
      }
    });
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    // Check if category is used in invoice items
    const invoiceItemsWithCategory = await prisma.invoiceLineItem.count({
      where: {
        taxCategoryId: id
      }
    });
    
    if (invoiceItemsWithCategory > 0) {
      return res.status(400).json({ 
        error: `Cannot delete category that is used in ${invoiceItemsWithCategory} invoice items. Please reassign these items first.` 
      });
    }
    
    // Delete the category
    await prisma.taxCategory.delete({
      where: { id }
    });
    
    return res.status(200).json(category);
  } catch (error) {
    console.error('Error deleting category:', error);
    return res.status(500).json({ error: 'Failed to delete category' });
  }
};

// Get category hierarchy
export const getCategoryHierarchy = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    
    if (!organizationId) {
      return res.status(401).json({ error: 'Unauthorized - Missing organization ID' });
    }
    
    // Get all categories for the organization
    const categories = await prisma.taxCategory.findMany({
      where: {
        organizationId
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    // Since tax categories don't have a hierarchy in our schema,
    // we'll just return the flat list
    return res.status(200).json(categories);
  } catch (error) {
    console.error('Error fetching category hierarchy:', error);
    return res.status(500).json({ error: 'Failed to fetch category hierarchy' });
  }
}; 