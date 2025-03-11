import { prisma } from '../models/prisma';

// Base interface for all service classes
export interface BaseService<T> {
  create(data: any, organizationId: string): Promise<T>;
  findById(id: string, organizationId: string): Promise<T | null>;
  findAll(organizationId: string, options?: any): Promise<T[]>;
  update(id: string, data: any, organizationId: string): Promise<T>;
  delete(id: string, organizationId: string): Promise<T>;
}

// Export prisma instance to be used by all services
export { prisma }; 