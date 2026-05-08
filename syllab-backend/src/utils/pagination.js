'use strict';

/**
 * Cursor-based pagination helpers.
 * Cursor is a base64-encoded record ID.
 */

function encodeCursor(id) {
  return Buffer.from(id, 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    // Validate it looks like a real ID (printable ASCII, no null bytes)
    if (!/^[\x20-\x7E]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Returns a Prisma-compatible cursor object for findMany
 */
function parseCursor(cursor) {
  if (!cursor) return {};
  const id = decodeCursor(cursor);
  if (!id) return {};
  return { cursor: { id }, skip: 1 };
}

module.exports = { encodeCursor, decodeCursor, parseCursor };
