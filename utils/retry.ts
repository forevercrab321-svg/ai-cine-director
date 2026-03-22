/**
 * 重试和错误恢复机制
 * 用于处理临时故障（网络超时、API限流等）
 */

export interface RetryOptions {
    maxAttempts?: number;           // 最大尝试次数，默认3
    initialDelayMs?: number;        // 初始延迟，默认100ms
    maxDelayMs?: number;            // 最大延迟，默认10000ms
    backoffMultiplier?: number;     // 退避倍数，默认2
    jitterFactor?: number;          // 随机抖动因子 (0-1)，默认0.1
    shouldRetry?: (error: any, attempt: number) => boolean; // 自定义重试条件
}

/**
 * 计算延迟时间 (指数退避 + 抖动)
 */
function calculateDelay(
    attempt: number,
    baseDelay: number,
    multiplier: number,
    maxDelay: number,
    jitterFactor: number
): number {
    const exponentialDelay = Math.min(
        baseDelay * Math.pow(multiplier, attempt),
        maxDelay
    );

    // 添加抖动以避免雷群问题
    const jitter = exponentialDelay * jitterFactor * Math.random();
    return exponentialDelay + jitter;
}

/**
 * 默认的重试条件
 */
function isRetryableError(error: any): boolean {
    // 网络错误
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
        return true;
    }

    // API限流或服务不可用
    const status = error?.status || error?.statusCode;
    if (status === 429 || status === 503 || status === 504 || status === 408) {
        return true;
    }

    // Replicate API特定错误
    if (error?.message?.includes('rate_limit') || error?.message?.includes('throttle')) {
        return true;
    }

    return false;
}

/**
 * 通用重试包装函数
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        initialDelayMs = 100,
        maxDelayMs = 10000,
        backoffMultiplier = 2,
        jitterFactor = 0.1,
        shouldRetry = isRetryableError,
    } = options;

    let lastError: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // 检查是否应该重试
            if (attempt === maxAttempts - 1 || !shouldRetry(error, attempt)) {
                throw error;
            }

            // 计算延迟并等待
            const delay = calculateDelay(
                attempt,
                initialDelayMs,
                backoffMultiplier,
                maxDelayMs,
                jitterFactor
            );

            console.log(
                `[Retry] Attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`
            );

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * 断路器 (Circuit Breaker) 模式
 * 用于防止持续调用已经失败的服务
 */
export class CircuitBreaker<T> {
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime: number | null = null;
    private readonly failureThreshold: number;
    private readonly successThreshold: number;
    private readonly timeout: number; // 从open到half-open的超时

    constructor(
        private fn: (...args: any[]) => Promise<T>,
        options: {
            failureThreshold?: number;
            successThreshold?: number;
            timeout?: number;
        } = {}
    ) {
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 60000; // 1分钟
    }

    async execute(...args: any[]): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - (this.lastFailureTime || 0) > this.timeout) {
                console.log('[CircuitBreaker] Transitioning to half-open state');
                this.state = 'half-open';
                this.successCount = 0;
            } else {
                throw new Error('Circuit breaker is open - service unavailable');
            }
        }

        try {
            const result = await this.fn(...args);

            // 成功
            if (this.state === 'half-open') {
                this.successCount++;
                if (this.successCount >= this.successThreshold) {
                    console.log('[CircuitBreaker] Transitioning to closed state');
                    this.state = 'closed';
                    this.failureCount = 0;
                }
            } else if (this.state === 'closed') {
                this.failureCount = 0; // 重置失败计数
            }

            return result;
        } catch (error) {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (this.failureCount >= this.failureThreshold) {
                console.log(
                    `[CircuitBreaker] Failure threshold reached (${this.failureCount}/${this.failureThreshold}), opening circuit`
                );
                this.state = 'open';
            }

            throw error;
        }
    }

    getState() {
        return this.state;
    }

    reset() {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
    }
}

/**
 * 超时包装函数
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage = '操作超时'
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
        ),
    ]);
}

/**
 * 带重试的超时包装
 */
export async function withRetryAndTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number = 30000,
    retryOptions: RetryOptions = {}
): Promise<T> {
    return withRetry(
        () => withTimeout(fn(), timeoutMs),
        retryOptions
    );
}

/**
 * 批量操作 with 部分失败恢复
 */
export async function batchWithRetry<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options: {
        concurrency?: number;
        retryOptions?: RetryOptions;
        onError?: (error: any, item: T, index: number) => void;
        continueOnError?: boolean; // 是否在部分失败时继续处理
    } = {}
): Promise<{ results: (R | null)[]; errors: (Error | null)[] }> {
    const {
        concurrency = 5,
        retryOptions = {},
        onError,
        continueOnError = true,
    } = options;

    const results: (R | null)[] = new Array(items.length).fill(null);
    const errors: (Error | null)[] = new Array(items.length).fill(null);

    // 分组处理
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchIndices = Array.from({ length: batch.length }, (_, j) => i + j);

        const promises = batch.map((item, batchIdx) => {
            const actualIdx = batchIndices[batchIdx];
            return withRetry(() => processor(item, actualIdx), retryOptions)
                .then(result => {
                    results[actualIdx] = result;
                })
                .catch(error => {
                    errors[actualIdx] = error;
                    onError?.(error, item, actualIdx);

                    if (!continueOnError) {
                        throw error;
                    }
                });
        });

        try {
            await Promise.all(promises);
        } catch (error) {
            if (!continueOnError) {
                throw error;
            }
        }
    }

    return { results, errors };
}

/**
 * 指数延迟的轮询
 */
export async function pollWithRetry<T>(
    fn: () => Promise<T | null>,
    options: {
        maxAttempts?: number;
        initialDelayMs?: number;
        maxDelayMs?: number;
    } = {}
): Promise<T> {
    const {
        maxAttempts = 30,
        initialDelayMs = 500,
        maxDelayMs = 5000,
    } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await fn();
        if (result !== null) {
            return result;
        }

        if (attempt < maxAttempts - 1) {
            const delay = Math.min(
                initialDelayMs * Math.pow(1.5, attempt),
                maxDelayMs
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error(`Polling failed after ${maxAttempts} attempts`);
}
