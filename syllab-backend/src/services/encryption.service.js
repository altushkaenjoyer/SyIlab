'use strict';

const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns base64-encoded string: iv:authTag:ciphertext
 */
function encrypt(plaintext) {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypts AES-256-GCM encrypted string.
 */
function decrypt(encryptedStr) {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'utf8');
  const [ivB64, tagB64, dataB64] = encryptedStr.split(':');

  const iv       = Buffer.from(ivB64, 'base64');
  const authTag  = Buffer.from(tagB64, 'base64');
  const data     = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * SHA-256 content hash for tamper detection
 */
function hashContent(plaintext) {
  return 'sha256:' + crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

module.exports = { encrypt, decrypt, hashContent };
