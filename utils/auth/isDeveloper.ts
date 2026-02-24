/**
 * isDeveloper - 检查用户是否在开发者白名单中
 * 
 * 安全性要求：
 * - 只能在服务端调用（依赖 process.env）
 * - 邮箱来自认证后的 session，不允许前端传入
 * - 大小写不敏感，自动 trim
 */

/**
 * 从环境变量解析开发者邮箱白名单
 * 环境变量格式: DEV_EMAIL_ALLOWLIST="email1@example.com,email2@example.com"
 */
export function getDeveloperAllowlist(): string[] {
  const raw = process.env.DEV_EMAIL_ALLOWLIST || '';
  if (!raw.trim()) return [];
  
  return raw
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0 && email.includes('@'));
}

/**
 * 检查给定邮箱是否是开发者（God Mode）
 * @param email - 来自认证 session 的用户邮箱
 * @returns boolean
 */
export function isDeveloper(email: string | null | undefined): boolean {
  if (!email) return false;
  
  const normalizedEmail = email.trim().toLowerCase();
  const allowlist = getDeveloperAllowlist();
  
  return allowlist.includes(normalizedEmail);
}

/**
 * 开发者模式日志（仅在开发环境打印敏感信息）
 */
export function logDeveloperAccess(email: string, action: string): void {
  const isDev = process.env.NODE_ENV !== 'production';
  const timestamp = new Date().toISOString();
  
  if (isDev) {
    console.log(`[GOD_MODE] ${timestamp} | ${email} | ${action}`);
  } else {
    // 生产环境只记录脱敏信息
    console.log(`[GOD_MODE] ${timestamp} | developer | ${action}`);
  }
}
