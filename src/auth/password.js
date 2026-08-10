import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import config from '../config.js';
export const PARAMS = {
  1: { memoryCost: 65536, timeCost: 3, parallelism: 1 },
};
export const CURRENT_VERSION = 1;
const MIN_LENGTH = 12;
const MAX_LENGTH = 256;
function pepper(password) {
  return config.passwordPepperEnabled ? `${password}${config.PASSWORD_PEPPER}` : password;
}
export class PasswordPolicyError extends Error {}
export function validatePolicy(password) {
  if (typeof password !== 'string') {
    throw new PasswordPolicyError('Password is required.');
  }
  const length = [...password].length;
  if (length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new PasswordPolicyError(`Password must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`);
  }
}
export async function hashPassword(password) {
  validatePolicy(password);
  const params = PARAMS[CURRENT_VERSION];
  const digest = await argon2Hash(pepper(password), { ...params });
  return { hash: digest, version: CURRENT_VERSION };
}
export async function verifyPassword(password, storedHash) {
  try {
    return await argon2Verify(storedHash, pepper(password));
  } catch {
    return false;
  }
}
export function needsRehash(version) {
  return version !== CURRENT_VERSION;
}
