'use strict';

const { z } = require('zod');

/**
 * Factory: validates req.body against a Zod schema.
 * Returns 422 with structured field errors on failure.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return res.status(422).json({
        error: 'VALIDATION_ERROR',
        message: 'Request body failed validation',
        status: 422,
        details: fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate query params
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return res.status(400).json({
        error: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        status: 400,
        details: fieldErrors,
      });
    }
    req.query = result.data;
    next();
  };
}

module.exports = { validate, validateQuery };
