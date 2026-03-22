/**
 * 统一的API错误处理和响应格式
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
    suggestion?: string;
  };
  traceId?: string;
  meta?: {
    cached?: boolean;
    duration?: number;
  };
}

/**
 * 标准API错误类
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: Record<string, any>,
    public suggestion?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 常见错误定义
 */
export const ErrorCodes = {
  // Auth errors
  AUTH_UNAUTHORIZED: { code: 'AUTH_UNAUTHORIZED', status: 401, message: '未授权' },
  AUTH_FORBIDDEN: { code: 'AUTH_FORBIDDEN', status: 403, message: '禁止访问' },
  AUTH_INVALID_TOKEN: { code: 'AUTH_INVALID_TOKEN', status: 401, message: '无效的认证令牌' },

  // Validation errors
  VALIDATION_FAILED: { code: 'VALIDATION_FAILED', status: 400, message: '验证失败' },
  MISSING_REQUIRED_FIELD: { code: 'MISSING_REQUIRED_FIELD', status: 400, message: '缺少必需字段' },
  INVALID_PARAMETER: { code: 'INVALID_PARAMETER', status: 400, message: '无效的参数' },

  // Credit system
  INSUFFICIENT_CREDITS: { code: 'INSUFFICIENT_CREDITS', status: 402, message: '积分不足' },
  CREDIT_DEDUCTION_FAILED: { code: 'CREDIT_DEDUCTION_FAILED', status: 500, message: '积分扣除失败' },

  // Resource errors
  NOT_FOUND: { code: 'NOT_FOUND', status: 404, message: '资源不存在' },
  ALREADY_EXISTS: { code: 'ALREADY_EXISTS', status: 409, message: '资源已存在' },
  CONFLICT: { code: 'CONFLICT', status: 409, message: '请求冲突' },

  // External API errors
  GEMINI_ERROR: { code: 'GEMINI_ERROR', status: 502, message: 'Gemini API 错误' },
  REPLICATE_ERROR: { code: 'REPLICATE_ERROR', status: 502, message: 'Replicate API 错误' },
  SUPABASE_ERROR: { code: 'SUPABASE_ERROR', status: 502, message: '数据库错误' },
  RATE_LIMIT: { code: 'RATE_LIMIT', status: 429, message: '请求过于频繁' },

  // Pipeline errors
  STORYBOARD_NOT_APPROVED: { code: 'STORYBOARD_NOT_APPROVED', status: 400, message: '分镜未批准' },
  INVALID_PIPELINE_STATE: { code: 'INVALID_PIPELINE_STATE', status: 400, message: '管道状态无效' },

  // Server errors
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500, message: '内部服务器错误' },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', status: 503, message: '服务暂时不可用' },
};

/**
 * 创建错误响应
 */
export function createErrorResponse(
  error: ApiError | Error,
  traceId?: string
): ApiResponse {
  if (error instanceof ApiError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        suggestion: error.suggestion,
      },
      traceId,
    };
  }

  // 未知错误，返回通用服务器错误
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: error.message || '内部服务器错误',
      suggestion: '请稍后重试或联系支持',
    },
    traceId,
  };
}

/**
 * 创建成功响应
 */
export function createSuccessResponse<T>(
  data: T,
  meta?: { cached?: boolean; duration?: number },
  traceId?: string
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta,
    traceId,
  };
}

/**
 * 创建特定的错误实例
 */
export const createError = {
  unauthorized: (message = '未授权', suggestion = '请重新登录') =>
    new ApiError('AUTH_UNAUTHORIZED', message, 401, undefined, suggestion),

  forbidden: (message = '禁止访问', suggestion = '您没有权限执行此操作') =>
    new ApiError('AUTH_FORBIDDEN', message, 403, undefined, suggestion),

  validationFailed: (details?: Record<string, any>, suggestion = '请检查输入数据') =>
    new ApiError('VALIDATION_FAILED', '验证失败', 400, details, suggestion),

  missingField: (fieldName: string) =>
    new ApiError(
      'MISSING_REQUIRED_FIELD',
      `缺少必需字段: ${fieldName}`,
      400,
      { field: fieldName },
      `请提供 ${fieldName} 字段`
    ),

  invalidParameter: (paramName: string, details?: string) =>
    new ApiError(
      'INVALID_PARAMETER',
      `无效的参数: ${paramName}`,
      400,
      { parameter: paramName, details },
      `请检查 ${paramName} 的值`
    ),

  insufficientCredits: (needed: number, available: number) =>
    new ApiError(
      'INSUFFICIENT_CREDITS',
      `积分不足: 需要 ${needed}，可用 ${available}`,
      402,
      { needed, available },
      '请购买更多积分或减少操作范围'
    ),

  notFound: (resource: string) =>
    new ApiError(
      'NOT_FOUND',
      `${resource} 不存在`,
      404,
      { resource },
      `检查 ${resource} 的ID是否正确`
    ),

  geminiError: (message: string, details?: Record<string, any>) =>
    new ApiError(
      'GEMINI_ERROR',
      `Gemini API 错误: ${message}`,
      502,
      details,
      '这是外部服务错误，请稍后重试'
    ),

  replicateError: (message: string, details?: Record<string, any>) =>
    new ApiError(
      'REPLICATE_ERROR',
      `Replicate API 错误: ${message}`,
      502,
      details,
      '这是外部服务错误，请稍后重试'
    ),

  storyboardNotApproved: (projectId: string) =>
    new ApiError(
      'STORYBOARD_NOT_APPROVED',
      '分镜未批准',
      400,
      { projectId },
      '请先在分镜审核阶段批准所有镜头'
    ),

  rateLimit: (retryAfter?: number) =>
    new ApiError(
      'RATE_LIMIT',
      '请求过于频繁',
      429,
      retryAfter ? { retryAfter } : undefined,
      `请在 ${retryAfter || 60} 秒后重试`
    ),

  internalError: (message = '内部服务器错误', details?: Record<string, any>) =>
    new ApiError(
      'INTERNAL_ERROR',
      message,
      500,
      details,
      '我们的工程师已收到此错误报告，正在处理'
    ),
};
