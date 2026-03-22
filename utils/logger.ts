/**
 * 结构化日志系统
 * - 服务端: 结构化JSON日志输出
 * - 客户端: 浏览器console日志
 */

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  action: string;
  duration?: number;
  userId?: string;
  projectId?: string;
  data?: Record<string, any>;
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  traceId?: string;
}

export interface ApiMetrics {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  statusCode: number;
  duration: number;
  userId?: string;
  traceId?: string;
  cached?: boolean;
  error?: string;
}

const isDevelopment = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
const isServer = typeof window === 'undefined';

let requestCounter = 0;

/**
 * 生成唯一的trace ID用于追踪请求链路
 */
export function generateTraceId(): string {
  return `${Date.now()}-${++requestCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 服务端结构化日志输出
 */
function logServer(entry: LogEntry): void {
  if (isServer) {
    const logObj = {
      ...entry,
      timestamp: new Date(entry.timestamp).toISOString(),
    };
    console.log(JSON.stringify(logObj));
  }
}

/**
 * 客户端日志输出
 */
function logClient(entry: LogEntry): void {
  if (!isServer && isDevelopment) {
    const style = {
      debug: 'color: #888',
      info: 'color: #0066cc; font-weight: bold',
      warn: 'color: #ff9900; font-weight: bold',
      error: 'color: #cc0000; font-weight: bold',
    };

    const prefix = `[${entry.module}:${entry.action}]`;
    console.log(`%c${prefix}`, style[entry.level], entry.data || '');
  }
}

/**
 * 主日志函数
 */
export function createLogger(module: string) {
  return {
    debug(action: string, data?: Record<string, any>, traceId?: string) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'debug',
        module,
        action,
        data,
        traceId,
      };
      logServer(entry);
      logClient(entry);
    },

    info(action: string, data?: Record<string, any>, traceId?: string) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        module,
        action,
        data,
        traceId,
      };
      logServer(entry);
      logClient(entry);
    },

    warn(action: string, data?: Record<string, any>, traceId?: string) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'warn',
        module,
        action,
        data,
        traceId,
      };
      logServer(entry);
      logClient(entry);
    },

    error(action: string, error: Error | string, data?: Record<string, any>, traceId?: string) {
      const err = typeof error === 'string' ? new Error(error) : error;
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        module,
        action,
        data,
        error: {
          message: err.message,
          stack: isDevelopment ? err.stack : undefined,
        },
        traceId,
      };
      logServer(entry);
      logClient(entry);
    },

    /**
     * 记录API请求指标
     */
    recordApiMetric(metric: ApiMetrics) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: metric.statusCode >= 400 ? 'error' : 'info',
        module: 'API',
        action: `${metric.method} ${metric.endpoint}`,
        duration: metric.duration,
        userId: metric.userId,
        data: {
          statusCode: metric.statusCode,
          cached: metric.cached,
          error: metric.error,
        },
        traceId: metric.traceId,
      };
      logServer(entry);
    },

    /**
     * 记录计时操作
     */
    async timed<T>(
      action: string,
      fn: () => Promise<T>,
      data?: Record<string, any>,
      traceId?: string
    ): Promise<T> {
      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;
        this.info(action, { ...data, duration }, traceId);
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        this.error(action, error as Error, { ...data, duration }, traceId);
        throw error;
      }
    },
  };
}

// 导出预创建的日志实例
export const logger = {
  api: createLogger('api'),
  gemini: createLogger('gemini'),
  replicate: createLogger('replicate'),
  supabase: createLogger('supabase'),
  auth: createLogger('auth'),
  pipeline: createLogger('pipeline'),
  shot: createLogger('shot'),
  payment: createLogger('payment'),
};
