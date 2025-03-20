import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    // Check if the table exists first
    console.log("Starting migration: Create PasswordResetToken table");

    // Create the table using raw SQL
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" TEXT NOT NULL,
        "token" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "usedAt" TIMESTAMP(3),
        
        CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "password_reset_tokens_token_key" UNIQUE ("token"),
        CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `;

    // Create index on token for faster lookups
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");
    `;

    console.log("Migration completed successfully: PasswordResetToken table created");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
