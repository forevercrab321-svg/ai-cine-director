/**
 * API错误处理最佳实践示例
 * 展示如何在路由中使用新的日志系统和错误类
 */

import { Request, Response } from 'express';
import { logger } from './logger';
import { createSuccessResponse, createErrorResponse, createError } from './apiError';

/**
 * 示例 1: 简单的数据验证路由
 */
export async function exampleValidationRoute(req: Request & { traceId: string }, res: Response) {
    const { projectId, shotId } = req.body;

    // 验证必需字段
    if (!projectId) {
        const err = createError.missingField('projectId');
        logger.api.error('validation_failed', err.message, { details: err.details }, req.traceId);
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    if (!shotId) {
        const err = createError.missingField('shotId');
        logger.api.error('validation_failed', err.message, { details: err.details }, req.traceId);
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    logger.api.info('validation_passed', { projectId, shotId }, req.traceId);

    res.json(createSuccessResponse({
        projectId,
        shotId,
        status: 'validated',
    }, undefined, req.traceId));
}

/**
 * 示例 2: 调用外部API的路由 (带重试和错误处理)
 */
export async function exampleGeminiRoute(
    req: Request & { traceId: string; userId?: string },
    res: Response,
    callGeminiAPI: (prompt: string) => Promise<string>
) {
    const { prompt } = req.body;

    if (!prompt) {
        const err = createError.missingField('prompt');
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    try {
        logger.api.debug('gemini_request_start', { promptLength: prompt.length }, req.traceId);

        const result = await logger.gemini.timed(
            'generate_content',
            () => callGeminiAPI(prompt),
            {
                userId: req.userId,
                projectId: req.body.projectId,
            },
            req.traceId
        );

        res.json(createSuccessResponse({
            result,
            tokens: result.length, // 粗略估计
        }, { duration: Date.now() }, req.traceId));

    } catch (error: any) {
        const err = createError.geminiError(
            error.message || 'Gemini API call failed',
            {
                originalError: error.message,
                code: error.code,
            }
        );

        logger.api.error('gemini_failed', err.message, {
            userId: req.userId,
            details: err.details,
        }, req.traceId);

        res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }
}

/**
 * 示例 3: 积分扣除操作 (带事务日志)
 */
export async function exampleCreditDeductionRoute(
    req: Request & { traceId: string; userId?: string },
    res: Response,
    deductCreditsFromDB: (userId: string, amount: number) => Promise<boolean>
) {
    const { amount } = req.body;
    const userId = req.userId;

    if (!userId) {
        const err = createError.unauthorized();
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    if (!amount || amount <= 0) {
        const err = createError.invalidParameter('amount', '必须大于0');
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    try {
        logger.payment.info('deduction_attempt', {
            userId,
            amount,
        }, req.traceId);

        const success = await deductCreditsFromDB(userId, amount);

        if (!success) {
            const err = createError.insufficientCredits(amount, 0);
            logger.payment.warn('insufficient_credits', {
                userId,
                requested: amount,
            }, req.traceId);
            return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
        }

        logger.payment.info('deduction_success', {
            userId,
            amount,
        }, req.traceId);

        res.json(createSuccessResponse({
            deducted: amount,
            timestamp: new Date().toISOString(),
        }, undefined, req.traceId));

    } catch (error: any) {
        const err = createError.creditDeductionFailed(amount);
        logger.payment.error('deduction_error', error.message, {
            userId,
            amount,
            error: error.message,
        }, req.traceId);

        res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }
}

/**
 * 示例 4: 数据库查询与缓存路由
 */
export async function exampleCachedRoute(
    req: Request & { traceId: string },
    res: Response,
    getFromDB: (id: string) => Promise<any>,
    cache: Map<string, { data: any; expiry: number }>
) {
    const { id } = req.params;

    if (!id) {
        const err = createError.missingField('id');
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    try {
        // 检查缓存
        const cached = cache.get(id);
        if (cached && cached.expiry > Date.now()) {
            logger.api.debug('cache_hit', { id }, req.traceId);
            return res.json(createSuccessResponse(cached.data, { cached: true }, req.traceId));
        }

        logger.api.debug('cache_miss', { id }, req.traceId);

        // 从DB查询
        const data = await logger.supabase.timed(
            'fetch_data',
            () => getFromDB(id),
            { id },
            req.traceId
        );

        if (!data) {
            const err = createError.notFound(`Resource ${id}`);
            return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
        }

        // 更新缓存 (5分钟TTL)
        cache.set(id, { data, expiry: Date.now() + 5 * 60 * 1000 });

        res.json(createSuccessResponse(data, { cached: false }, req.traceId));

    } catch (error: any) {
        const err = createError.internalError(
            error.message || 'Database query failed',
            { resourceId: id }
        );
        logger.supabase.error('query_failed', error.message, { id }, req.traceId);

        res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }
}

/**
 * 示例 5: 长时间运行操作 (异步任务) 的监控
 */
export async function exampleLongRunningRoute(
    req: Request & { traceId: string; userId?: string },
    res: Response,
    startAsyncTask: (userId: string, traceId: string) => Promise<string>
) {
    const userId = req.userId;

    if (!userId) {
        const err = createError.unauthorized();
        return res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }

    try {
        logger.api.info('long_task_started', { userId }, req.traceId);

        // 立即返回task ID，后台继续处理
        const taskId = await startAsyncTask(userId, req.traceId);

        logger.api.info('long_task_queued', { userId, taskId }, req.traceId);

        res.json(createSuccessResponse({
            taskId,
            status: 'queued',
            pollUrl: `/api/tasks/${taskId}/status`,
        }, undefined, req.traceId));

    } catch (error: any) {
        const err = createError.internalError('Failed to queue task');
        logger.api.error('long_task_error', error.message, { userId }, req.traceId);

        res.status(err.statusCode).json(createErrorResponse(err, req.traceId));
    }
}
