import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Truncate all tables in the correct dependency order for a clean test state */
export async function cleanDatabase(): Promise<void> {
  const tablesToTruncate = [
    'activity_logs',
    'notifications',
    'comments',
    'task_labels',
    'tasks',
    'labels',
    'projects',
    'org_invitations',
    'org_members',
    'organizations',
    'password_reset_tokens',
    'refresh_tokens',
    'users',
  ];

  // Use raw SQL TRUNCATE CASCADE for speed
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE`,
  );
}

export { prisma as testPrisma };
