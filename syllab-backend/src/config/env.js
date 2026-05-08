'use strict';

const { z } = require('zod');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  ENCRYPTION_KEY: z.string().length(32, 'ENCRYPTION_KEY must be exactly 32 chars'),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Email / SMTP
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().transform(v => v === 'true').pipe(z.boolean()).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().default('noreply@syllab.local'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite-preview'),

  THRESHOLD_WATCH:     z.coerce.number().default(0.27),
  THRESHOLD_REVIEW:    z.coerce.number().default(0.50),
  THRESHOLD_ESCALATE:  z.coerce.number().default(0.65),
  THRESHOLD_HIGH_RISK: z.coerce.number().default(0.80),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error('\n❌ Missing or invalid environment variables:\n' + errors + '\n');
    process.exit(1);
  }
  return result.data;
}

module.exports = validateEnv();
