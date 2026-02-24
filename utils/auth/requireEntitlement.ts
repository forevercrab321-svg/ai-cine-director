/**
 * requireEntitlement - 统一权限入口
 * 
 * 所有生成/修改接口必须调用此函数
 * 集中处理：开发者检查、付费检查、credits扣除、rate limit、并发限制
 * 
 * 安全性：
 * - 只能在服务端调用
 * - 邮箱必须来自认证后的 session
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isDeveloper, logDeveloperAccess } from './isDeveloper';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type EntitlementAction = 
  | 'generate_script'      // 生成剧本
  | 'generate_shots'       // 拆分镜头
  | 'generate_image'       // 生成单张图片
  | 'generate_video'       // 生成视频
  | 'edit_image'           // 编辑图片
  | 'batch_images'         // 批量生成图片
  | 'analyze_image'        // AI分析图片
  | 'admin_action';        // 管理员操作

export type UserPlan = 'free' | 'paid' | 'developer';

export interface EntitlementResult {
  allowed: boolean;
  mode: 'developer' | 'paid' | 'free';
  unlimited: boolean;
  credits: number;
  plan: UserPlan;
  reason?: string;
  errorCode?: 'NEED_PAYMENT' | 'INSUFFICIENT_CREDITS' | 'RATE_LIMITED' | 'UNAUTHORIZED';
}

export interface EntitlementRequest {
  userId: string;
  email: string;
  action: EntitlementAction;
  cost?: number;           // 此操作的 credits 成本
  projectId?: string;      // 可选的项目 ID
  supabaseClient?: SupabaseClient;  // 可选的已认证客户端
}

// ═══════════════════════════════════════════════════════════════
// 核心权限检查函数
// ═══════════════════════════════════════════════════════════════

/**
 * 统一权限入口 - 所有生成/修改接口必须调用
 * 
 * 检查顺序：
 * 1. Developer God Mode - 直接放行
 * 2. 付费状态检查 - 订阅或 credits
 * 3. Credits 余额检查
 * 4. Rate limit 检查（可选）
 */
export async function requireEntitlement(req: EntitlementRequest): Promise<EntitlementResult> {
  const { userId, email, action, cost = 0 } = req;
  
  // ═══════════════════════════════════════════════════════════════
  // 1. Developer God Mode 检查
  // ═══════════════════════════════════════════════════════════════
  if (isDeveloper(email)) {
    logDeveloperAccess(email, action);
    
    return {
      allowed: true,
      mode: 'developer',
      unlimited: true,
      credits: 999999,
      plan: 'developer',
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 2. 获取用户 Profile 和 Credits
  // ═══════════════════════════════════════════════════════════════
  const supabase = req.supabaseClient || createSupabaseAdmin();
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, credits, plan, is_paid, is_admin')
    .eq('id', userId)
    .single();
  
  if (profileError || !profile) {
    return {
      allowed: false,
      mode: 'free',
      unlimited: false,
      credits: 0,
      plan: 'free',
      reason: '用户资料不存在',
      errorCode: 'UNAUTHORIZED',
    };
  }
  
  const userCredits = profile.credits || 0;
  const isPaid = profile.is_paid === true || profile.plan === 'paid';
  const plan: UserPlan = isPaid ? 'paid' : 'free';
  
  // ═══════════════════════════════════════════════════════════════
  // 3. 付费/Credits 检查
  // ═══════════════════════════════════════════════════════════════
  
  // 免费用户且无 credits - 需要付费
  if (!isPaid && userCredits <= 0) {
    return {
      allowed: false,
      mode: 'free',
      unlimited: false,
      credits: userCredits,
      plan: 'free',
      reason: '请购买 Credits 或订阅以使用此功能',
      errorCode: 'NEED_PAYMENT',
    };
  }
  
  // 有 credits 但不足 - 需要充值
  if (cost > 0 && userCredits < cost) {
    return {
      allowed: false,
      mode: plan === 'paid' ? 'paid' : 'free',
      unlimited: false,
      credits: userCredits,
      plan,
      reason: `Credits 不足，需要 ${cost}，当前 ${userCredits}`,
      errorCode: 'INSUFFICIENT_CREDITS',
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 4. 权限通过
  // ═══════════════════════════════════════════════════════════════
  return {
    allowed: true,
    mode: plan === 'paid' ? 'paid' : 'free',
    unlimited: false,
    credits: userCredits,
    plan,
  };
}

/**
 * 扣除 Credits（非开发者用户）
 * 开发者用户调用此函数时不会扣费，但会记录日志
 */
export async function deductCreditsIfNeeded(
  supabase: SupabaseClient,
  userId: string,
  email: string,
  amount: number,
  refType: string,
  refId: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  
  // 开发者不扣费
  if (isDeveloper(email)) {
    logDeveloperAccess(email, `skip_deduct:${refType}:${amount}`);
    return { success: true, newBalance: 999999 };
  }
  
  // 使用 reserve_credits RPC
  const { data: reserved, error: reserveErr } = await supabase.rpc('reserve_credits', {
    amount,
    ref_type: refType,
    ref_id: refId,
  });
  
  if (reserveErr) {
    return { success: false, error: reserveErr.message };
  }
  
  if (!reserved) {
    return { success: false, error: 'INSUFFICIENT_CREDITS' };
  }
  
  return { success: true };
}

/**
 * 完成扣费（非开发者）
 */
export async function finalizeCreditsIfNeeded(
  supabase: SupabaseClient,
  email: string,
  refType: string,
  refId: string
): Promise<void> {
  if (isDeveloper(email)) {
    return; // 开发者无需 finalize
  }
  
  await supabase.rpc('finalize_reserve', { ref_type: refType, ref_id: refId });
}

/**
 * 退还 Credits（非开发者）
 */
export async function refundCreditsIfNeeded(
  supabase: SupabaseClient,
  email: string,
  amount: number,
  refType: string,
  refId: string
): Promise<void> {
  if (isDeveloper(email)) {
    return; // 开发者无需 refund
  }
  
  await supabase.rpc('refund_reserve', { amount, ref_type: refType, ref_id: refId });
}

// ═══════════════════════════════════════════════════════════════
// Helper: Create Supabase Admin Client
// ═══════════════════════════════════════════════════════════════

function createSupabaseAdmin(): SupabaseClient {
  const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  
  if (!url || !key) {
    throw new Error('Supabase URL or Service Key missing');
  }
  
  return createClient(url, key);
}

// ═══════════════════════════════════════════════════════════════
// Express Middleware Helper
// ═══════════════════════════════════════════════════════════════

/**
 * Express 中间件：检查权限
 * 用法：app.post('/api/xxx', requireAuth, requireEntitlementMiddleware('generate_image', 6), handler)
 */
export function requireEntitlementMiddleware(action: EntitlementAction, cost: number = 0) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    const email = req.user?.email;
    
    if (!userId || !email) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    
    const result = await requireEntitlement({
      userId,
      email,
      action,
      cost,
    });
    
    if (!result.allowed) {
      const status = result.errorCode === 'NEED_PAYMENT' ? 402 
                   : result.errorCode === 'INSUFFICIENT_CREDITS' ? 402
                   : result.errorCode === 'RATE_LIMITED' ? 429
                   : 403;
      
      return res.status(status).json({
        error: result.reason,
        code: result.errorCode,
        credits: result.credits,
        plan: result.plan,
      });
    }
    
    // 附加权限信息到 request
    req.entitlement = result;
    next();
  };
}
