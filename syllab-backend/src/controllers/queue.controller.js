'use strict';

const { getClient } = require('../config/database');
const { parseCursor, encodeCursor } = require('../utils/pagination');

async function getQueue(req, res, next) {
  try {
    const prisma = getClient();
    const { course_id, status = 'PENDING', min_score, cursor, limit = '20' } = req.query;
    const take = Math.min(parseInt(limit), 50);
    const cursorWhere = parseCursor(cursor);

    const where = {
      status,
      ...(min_score && { priorityScore: { gte: parseFloat(min_score) } }),
      ...(course_id && { submission: { courseId: course_id } }),
    };

    const items = await prisma.instructorQueue.findMany({
      where,
      ...cursorWhere,
      take: take + 1,
      orderBy: { priorityScore: 'desc' },
      include: {
        submission: {
          select: {
            id: true, studentId: true, courseId: true,
            weekNumber: true, flagLevel: true, ensembleScore: true, submittedAt: true,
            student: { select: { fullName: true, email: true } },
          },
        },
      },
    });

    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1].id) : null;

    return res.status(200).json({
      data: data.map(item => ({
        id: item.id,
        submission_id: item.submissionId,
        priority_score: item.priorityScore,
        status: item.status,
        created_at: item.createdAt,
        submission: item.submission,
      })),
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    });
  } catch (err) {
    next(err);
  }
}

async function getQueueItem(req, res, next) {
  try {
    const prisma = getClient();
    const { item_id } = req.params;

    const item = await prisma.instructorQueue.findUnique({
      where: { id: item_id },
      include: {
        submission: {
          include: {
            features: true,
            violations: true,
            student: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Queue item not found', status: 404 });
    }

    return res.status(200).json({ data: item });
  } catch (err) {
    next(err);
  }
}

async function resolveQueueItem(req, res, next) {
  try {
    const prisma = getClient();
    const { item_id } = req.params;
    const { status, instructor_note } = req.body;

    const item = await prisma.instructorQueue.findUnique({ where: { id: item_id } });
    if (!item) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Queue item not found', status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.instructorQueue.update({
        where: { id: item_id },
        data: { status, instructorNote: instructor_note, resolvedAt: new Date() },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'RESOLVE_QUEUE',
          entityType: 'instructor_queue',
          entityId: item_id,
          oldValue: { status: item.status },
          newValue: { status, instructor_note },
          ipAddress: req.ip,
        },
      });

      return q;
    });

    return res.status(200).json({ data: { id: updated.id, status: updated.status, resolved_at: updated.resolvedAt } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getQueue, getQueueItem, resolveQueueItem };
