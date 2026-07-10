// src/controllers/import.controller.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ══════════════════════════════════════════════════════════════════════
//  1) BULK UPDATE EMPLOYEE IDs
//  Frontend reads the file and posts { rows: [{ email, employeeId }, ...] }
//  Matches existing users by email and sets their employeeId.
// ══════════════════════════════════════════════════════════════════════
export const bulkUpdateEmployeeIds = async (req, res, next) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No rows received. Please upload a valid file.',
      });
    }
    if (rows.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Too many rows (max 5000 per import). Split the file and try again.',
      });
    }

    const updated    = [];
    const notFound    = [];
    const duplicates  = [];
    const skipped     = [];
    const seenIdsInFile = new Map(); // employeeId -> email

    for (const raw of rows) {
      const email      = String(raw?.email ?? '').trim().toLowerCase();
      const employeeId = String(raw?.employeeId ?? '').trim();

      if (!email || !employeeId) { skipped.push({ email: raw?.email ?? '(blank)' }); continue; }

      if (seenIdsInFile.has(employeeId) && seenIdsInFile.get(employeeId) !== email) {
        duplicates.push({ email, employeeId }); continue;
      }

      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!user) { notFound.push({ email, employeeId }); continue; }

      const clash = await prisma.user.findFirst({
        where: { employeeId, NOT: { id: user.id } }, select: { id: true },
      });
      if (clash) { duplicates.push({ email, employeeId }); continue; }

      await prisma.user.update({ where: { id: user.id }, data: { employeeId } });
      seenIdsInFile.set(employeeId, email);
      updated.push({ email, employeeId });
    }

    return res.status(200).json({
      success: true,
      message: `Import complete: ${updated.length} updated, ${notFound.length} not found, ${duplicates.length} duplicate, ${skipped.length} skipped.`,
      summary: { updated, notFound, duplicates, skipped },
    });
  } catch (err) {
    next(err);
  }
};

// ══════════════════════════════════════════════════════════════════════
//  2) BULK CREATE USERS
//  Frontend reads the file and posts:
//    { rows: [{ name, email, password, employeeId?, role? }, ...] }
//
//  Creates a new account per row. Reports per-row problems instead of
//  failing the whole batch. Passwords are hashed before saving.
//
//  Summary shape:
//    {
//      created:  [{ name, email }],
//      failed:   [{ email, reason }],   // duplicate email / missing field / dup emp id
//    }
// ══════════════════════════════════════════════════════════════════════
export const bulkCreateUsers = async (req, res, next) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No rows received. Please upload a valid file.',
      });
    }
    if (rows.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Too many rows (max 2000 users per import). Split the file and try again.',
      });
    }

    const created = [];
    const failed  = [];

    // Track values seen WITHIN this file so two rows can't collide silently
    const seenEmails = new Set();
    const seenEmpIds = new Set();

    for (const raw of rows) {
      const name       = String(raw?.name ?? '').trim();
      const email      = String(raw?.email ?? '').trim();
      const emailLower = email.toLowerCase();
      const password   = String(raw?.password ?? '');
      const employeeId = String(raw?.employeeId ?? '').trim();
      const roleInput  = String(raw?.role ?? '').trim().toUpperCase();
      const role       = roleInput === 'ADMIN' ? 'ADMIN' : 'EMPLOYEE'; // default EMPLOYEE

      // ── Row validation ──
      if (!name || !email || !password) {
        failed.push({ email: email || '(blank)', reason: 'Missing name, email, or password' });
        continue;
      }
      if (password.length < 6) {
        failed.push({ email, reason: 'Password must be at least 6 characters' });
        continue;
      }
      if (seenEmails.has(emailLower)) {
        failed.push({ email, reason: 'Duplicate email within the file' });
        continue;
      }
      if (employeeId && seenEmpIds.has(employeeId)) {
        failed.push({ email, reason: `Duplicate employee ID "${employeeId}" within the file` });
        continue;
      }

      // ── Check against the database ──
      const emailExists = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true },
      });
      if (emailExists) {
        failed.push({ email, reason: 'A user with this email already exists' });
        continue;
      }

      if (employeeId) {
        const idExists = await prisma.user.findFirst({
          where: { employeeId }, select: { id: true },
        });
        if (idExists) {
          failed.push({ email, reason: `Employee ID "${employeeId}" already assigned to another user` });
          continue;
        }
      }

      // ── Create ──
      try {
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.create({
          data: {
            name, email, password: hashed, role,
            ...(employeeId ? { employeeId } : {}),
          },
        });
        seenEmails.add(emailLower);
        if (employeeId) seenEmpIds.add(employeeId);
        created.push({ name, email });
      } catch (e) {
        failed.push({ email, reason: 'Could not create (database error)' });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Import complete: ${created.length} created, ${failed.length} failed.`,
      summary: { created, failed },
    });
  } catch (err) {
    next(err);
  }
};