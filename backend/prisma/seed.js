// prisma/seed.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const salt = await bcrypt.genSalt(10);

  const users = [
    {
      name:     'Super Admin',
      email:    'admin@company.com',
      password: await bcrypt.hash('Admin@123', salt),
      role:     'ADMIN',
    },
    {
      name:     'Jane Employee',
      email:    'employee@company.com',
      password: await bcrypt.hash('Employee@123', salt),
      role:     'EMPLOYEE',
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where:  { email: user.email },
      update: {},
      create: user,
    });
    console.log(`✅ Seeded: ${user.role} → ${user.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());