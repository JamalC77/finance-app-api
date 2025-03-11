import { User, Prisma, UserRole } from '@prisma/client';
import { BaseService, prisma } from './baseService';
import bcrypt from 'bcryptjs';

export interface CreateUserInput extends Omit<Prisma.UserCreateInput, 'password' | 'organization'> {
  password: string;
  organizationId: string;
}

export class UserService implements BaseService<User> {
  async create(data: CreateUserInput, organizationId: string): Promise<User> {
    // Hash the password
    const hashedPassword = await bcrypt.hash(data.password, 10);
    
    return prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
        organization: {
          connect: { id: organizationId }
        }
      }
    });
  }

  async findById(id: string, organizationId: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        id,
        organizationId
      }
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email }
    });
  }

  async findAll(organizationId: string): Promise<User[]> {
    return prisma.user.findMany({
      where: { organizationId }
    });
  }

  async update(id: string, data: Partial<User>, organizationId: string): Promise<User> {
    // If updating password, hash it
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }
    
    return prisma.user.update({
      where: {
        id,
      },
      data
    });
  }

  async delete(id: string, organizationId: string): Promise<User> {
    return prisma.user.delete({
      where: {
        id,
      }
    });
  }

  async validateCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);
    
    if (!user) {
      return null;
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    return isValidPassword ? user : null;
  }

  async updateLastLogin(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() }
    });
  }

  async changeRole(id: string, role: UserRole, organizationId: string): Promise<User> {
    return prisma.user.update({
      where: {
        id,
      },
      data: { role }
    });
  }
}

export const userService = new UserService(); 