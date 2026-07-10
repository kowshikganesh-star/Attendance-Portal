// src/controllers/user.controller.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Shared select so every response returns the same user shape (now includes employeeId)
const userSelect = {
  id: true, name: true, email: true, employeeId: true,
  role: true, isActive: true, createdAt: true,
};

// Normalize an incoming employeeId: trim it; treat empty string as null (freelancers)
const cleanEmployeeId = (val) => {
  if (val === undefined) return undefined;      // field not sent → don't change it
  const trimmed = String(val).trim();
  return trimmed === '' ? null : trimmed;       // blank → null
};

export const getUsers = async (req, res, next) => {
  try {
    const { search, role } = req.query;

    const where = {
      ...(role && role !== 'ALL' ? { role } : {}),
      ...(search ? {
        OR: [
          { name:       { contains: search, mode: 'insensitive' } },
          { email:      { contains: search, mode: 'insensitive' } },
          { employeeId: { contains: search, mode: 'insensitive' } }, // search by emp id too
        ],
      } : {}),
    };

    const users = await prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, users });
  } catch (err) {
    next(err);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, employeeId } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required.',
      });
    }

    if (!['EMPLOYEE'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be EMPLOYEE.',
      });
    }

    const emailExists = await prisma.user.findUnique({ where: { email } });
    if (emailExists) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists.',
      });
    }

    // employeeId is optional (freelancers have none). If given, it must be unique.
    const empId = cleanEmployeeId(employeeId);
    if (empId) {
      const idExists = await prisma.user.findUnique({ where: { employeeId: empId } });
      if (idExists) {
        return res.status(409).json({
          success: false,
          message: `Employee ID "${empId}" is already assigned to another user.`,
        });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name, email, password: hashed, role,
        ...(empId !== undefined && { employeeId: empId }),
      },
      select: userSelect,
    });

    return res.status(201).json({
      success: true,
      message: `${role} account created successfully.`,
      user,
    });
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { id }                          = req.params;
    const { name, email, role, employeeId } = req.body;

    if (parseInt(id) === req.user.id && role && role !== req.user.role) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role.',
      });
    }

    if (role && !['ADMIN', 'EMPLOYEE'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role.',
      });
    }

    if (email) {
      const conflict = await prisma.user.findFirst({
        where: { email, NOT: { id: parseInt(id) } },
      });
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: 'Email is already used by another user.',
        });
      }
    }

    // If employeeId provided, it must be unique (unless it's blank → clearing it)
    const empId = cleanEmployeeId(employeeId);
    if (empId) {
      const idConflict = await prisma.user.findFirst({
        where: { employeeId: empId, NOT: { id: parseInt(id) } },
      });
      if (idConflict) {
        return res.status(409).json({
          success: false,
          message: `Employee ID "${empId}" is already assigned to another user.`,
        });
      }
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(role && { role }),
        ...(empId !== undefined && { employeeId: empId }), // undefined = not sent; null = cleared
      },
      select: userSelect,
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      user,
    });
  } catch (err) {
    next(err);
  }
};

export const toggleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account.',
      });
    }

    const current = await prisma.user.findUnique({ where: { id: parseInt(id) } });
    if (!current) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data:  { isActive: !current.isActive },
      select: userSelect,
    });

    return res.status(200).json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully.`,
      user,
    });
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { id }          = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: parseInt(id) },
      data:  { password: hashed },
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account.',
      });
    }

    await prisma.attendance.deleteMany({ where: { userId: parseInt(id) } });
    await prisma.leaveRequest.deleteMany({ where: { userId: parseInt(id) } });
    await prisma.user.delete({ where: { id: parseInt(id) } });

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};