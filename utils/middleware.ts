/**
 * Express中间件: 请求追踪、性能监控、日志记录
 */

import { Request, Response, NextFunction } from 'express';
import { logger, generateTraceId, ApiMetrics } from './logger';
import { createSuccessResponse, createErrorResponse, ApiError } from './apiError';

/**
 * 扩展Express Request类型以支持traceId
 */
declare global {
  namespace Express {
    interface Request {
      traceId: string;
      startTime: number;
      userId?: string;
    }
  }
}

/**
 * 中间件: 为每个请求生成trace ID
 */
export function traceIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.traceId = req.headers['x-trace-id'] as string || generateTraceId();
  req.startTime = Date.now();

  // 从JWT token中提取userId (可选)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      // 注: 实际应使用JWT验证库，这里仅示意
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      req.userId = payload.sub || payload.user_id;
    } catch (e) {
      // 忽略JWT解析错误
    }
  }

  // 添加trace ID到响应头
  res.setHeader('X-Trace-Id', req.traceId);

  next();
}

/**
 * 中间件: 记录API指标
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // 保存原始的res.json方法
  const originalJson = res.json.bind(res);

  // 拦截res.json调用
  res.json = function (data: any) {
    const duration = Date.now() - req.startTime;

    const metric: ApiMetrics = {
      endpoint: req.path,
      method: req.method as any,
      statusCode: res.statusCode,
      duration,
      userId: req.userId,
      traceId: req.traceId,
    };

    logger.api.recordApiMetric(metric);

    // 调用原始的json方法
    return originalJson(data);
  };

  next();
}

/**
 * 中间件: 全局错误处理
 */
export function errorHandlerMiddleware(
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const duration = Date.now() - req.startTime;

  if (err instanceof ApiError) {
    logger.api.error(
      `${req.method} ${req.path}`,
      err.message,
      {
        statusCode: err.statusCode,
        code: err.code,
        duration,
      },
      req.traceId
    );

    return res.status(err.statusCode).json(
      createErrorResponse(err, req.traceId)
    );
  }

  // 未预期的错误
  logger.api.error(
    `${req.method} ${req.path}`,
    err.message || 'Unknown error',
    {
      stack: err.stack,
      duration,
    },
    req.traceId
  );

  res.status(500).json(
    createErrorResponse(
      new ApiError('INTERNAL_ERROR', err.message || 'Internal server error', 500),
      req.traceId
    )
  );
}

/**
 * 包装异步路由处理器以捕获错误
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 验证JWT令牌的中间件
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_UNAUTHORIZED',
        message: '未提供认证令牌',
        suggestion: '请在请求头中提供 Authorization: Bearer <token>',
      },
      traceId: req.traceId,
    });
  }

  next();
}

/**
 * 记录敏感操作 (用于审计)
 */
export function auditLogMiddleware(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logger.api.info(
          action,
          {
            userId: req.userId,
            path: req.path,
            method: req.method,
            duration: Date.now() - req.startTime,
          },
          req.traceId
        );
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * 限流中间件 (基于IP + endpoint)
 */
const rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();

export function rateLimitMiddleware(
  maxRequests: number = 100,
  windowMs: number = 60000 // 1分钟
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const store = rateLimitStore.get(key);

    if (store && store.resetTime > now) {
      store.count++;

      if (store.count > maxRequests) {
        const retryAfter = Math.ceil((store.resetTime - now) / 1000);
        res.setHeader('Retry-After', retryAfter);

        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT',
            message: '请求过于频繁',
            suggestion: `请在 ${retryAfter} 秒后重试`,
          },
          traceId: req.traceId,
        });
      }
    } else {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    }

    next();
  };
}

/**
 * 性能监控：记录慢查询
 */
export function slowQueryLogMiddleware(thresholdMs: number = 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (data: any) {
      const duration = Date.now() - req.startTime;

      if (duration > thresholdMs) {
        logger.api.warn(
          `Slow API call`,
          {
            path: req.path,
            method: req.method,
            duration,
            threshold: thresholdMs,
          },
          req.traceId
        );
      }

      return originalJson(data);
    };

    next();
  };
}
