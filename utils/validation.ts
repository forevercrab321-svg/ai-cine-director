/**
 * 输入验证 Schema 集合
 * 使用原生TypeScript类型定义 (无需zod依赖)
 * 提供运行时验证函数
 */

export interface ValidationResult<T = any> {
    valid: boolean;
    data?: T;
    errors?: { field: string; message: string }[];
}

/**
 * 通用验证器工厂函数
 */
export function createValidator<T>(schema: {
    fields: Record<string, FieldValidator>;
    required?: string[];
}) {
    return (data: any): ValidationResult<T> => {
        const errors: { field: string; message: string }[] = [];
        const validated: any = {};

        // 检查必需字段
        if (schema.required) {
            for (const field of schema.required) {
                if (data[field] === undefined || data[field] === null || data[field] === '') {
                    errors.push({
                        field,
                        message: `${field} 是必需的`,
                    });
                }
            }
        }

        // 验证每个字段
        for (const [field, validator] of Object.entries(schema.fields)) {
            if (data[field] === undefined) continue;

            const result = validator(data[field], field);
            if (!result.valid) {
                errors.push({
                    field,
                    message: result.error || `${field} 验证失败`,
                });
            } else {
                validated[field] = result.value ?? data[field];
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return { valid: true, data: validated };
    };
}

/**
 * 字段验证器类型
 */
interface FieldValidator {
    (value: any, fieldName?: string): { valid: boolean; error?: string; value?: any };
}

/**
 * 基础验证器
 */
export const validators = {
    string: (options?: { minLength?: number; maxLength?: number; pattern?: RegExp }): FieldValidator => {
        return (value: any) => {
            if (typeof value !== 'string') {
                return { valid: false, error: '必须是字符串' };
            }
            if (options?.minLength && value.length < options.minLength) {
                return { valid: false, error: `最少 ${options.minLength} 个字符` };
            }
            if (options?.maxLength && value.length > options.maxLength) {
                return { valid: false, error: `最多 ${options.maxLength} 个字符` };
            }
            if (options?.pattern && !options.pattern.test(value)) {
                return { valid: false, error: '格式不符合要求' };
            }
            return { valid: true, value: value.trim() };
        };
    },

    number: (options?: { min?: number; max?: number; integer?: boolean }): FieldValidator => {
        return (value: any) => {
            const num = Number(value);
            if (isNaN(num)) {
                return { valid: false, error: '必须是数字' };
            }
            if (options?.integer && !Number.isInteger(num)) {
                return { valid: false, error: '必须是整数' };
            }
            if (options?.min !== undefined && num < options.min) {
                return { valid: false, error: `最小值 ${options.min}` };
            }
            if (options?.max !== undefined && num > options.max) {
                return { valid: false, error: `最大值 ${options.max}` };
            }
            return { valid: true, value: num };
        };
    },

    email: (): FieldValidator => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return (value: any) => {
            if (typeof value !== 'string') {
                return { valid: false, error: '必须是字符串' };
            }
            if (!emailRegex.test(value)) {
                return { valid: false, error: '无效的邮箱地址' };
            }
            return { valid: true, value: value.toLowerCase() };
        };
    },

    enum: (allowedValues: string[]): FieldValidator => {
        return (value: any) => {
            if (!allowedValues.includes(String(value))) {
                return { valid: false, error: `必须是 ${allowedValues.join(', ')} 之一` };
            }
            return { valid: true, value };
        };
    },

    boolean: (): FieldValidator => {
        return (value: any) => {
            if (typeof value === 'boolean') {
                return { valid: true, value };
            }
            if (value === 'true' || value === 1) return { valid: true, value: true };
            if (value === 'false' || value === 0) return { valid: true, value: false };
            return { valid: false, error: '必须是布尔值' };
        };
    },

    uuid: (): FieldValidator => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return (value: any) => {
            if (typeof value !== 'string') {
                return { valid: false, error: '必须是字符串' };
            }
            if (!uuidRegex.test(value)) {
                return { valid: false, error: '无效的UUID格式' };
            }
            return { valid: true, value };
        };
    },

    url: (): FieldValidator => {
        return (value: any) => {
            if (typeof value !== 'string') {
                return { valid: false, error: '必须是字符串' };
            }
            try {
                new URL(value);
                return { valid: true, value };
            } catch {
                return { valid: false, error: '无效的URL' };
            }
        };
    },

    array: (itemValidator?: FieldValidator, options?: { minLength?: number; maxLength?: number }): FieldValidator => {
        return (value: any) => {
            if (!Array.isArray(value)) {
                return { valid: false, error: '必须是数组' };
            }
            if (options?.minLength && value.length < options.minLength) {
                return { valid: false, error: `最少 ${options.minLength} 项` };
            }
            if (options?.maxLength && value.length > options.maxLength) {
                return { valid: false, error: `最多 ${options.maxLength} 项` };
            }
            if (itemValidator) {
                for (let i = 0; i < value.length; i++) {
                    const itemResult = itemValidator(value[i], `item[${i}]`);
                    if (!itemResult.valid) {
                        return { valid: false, error: `数组项 ${i}: ${itemResult.error}` };
                    }
                }
            }
            return { valid: true, value };
        };
    },

    object: (schema: Record<string, FieldValidator>): FieldValidator => {
        return (value: any) => {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                return { valid: false, error: '必须是对象' };
            }
            const validated: any = {};
            for (const [key, validator] of Object.entries(schema)) {
                if (value[key] === undefined) continue;
                const result = validator(value[key], key);
                if (!result.valid) {
                    return { valid: false, error: `${key}: ${result.error}` };
                }
                validated[key] = result.value ?? value[key];
            }
            return { valid: true, value: validated };
        };
    },

    optional: (validator: FieldValidator): FieldValidator => {
        return (value: any) => {
            if (value === undefined || value === null) {
                return { valid: true, value: undefined };
            }
            return validator(value);
        };
    },
};

/**
 * 预定义的验证schema
 */
export const schemas = {
    // 生成故事板
    geminiGenerate: createValidator({
        fields: {
            story_idea: validators.string({ maxLength: 2000 }),
            visual_style: validators.string({ maxLength: 200 }),
            character_anchor: validators.optional(validators.string({ maxLength: 500 })),
            scene_count: validators.optional(validators.number({ min: 1, max: 20, integer: true })),
            target_shot_count: validators.optional(validators.number({ min: 1, max: 10, integer: true })),
        },
        required: ['story_idea'],
    }),

    // 生成镜头图片
    generateShotImage: createValidator({
        fields: {
            project_id: validators.uuid(),
            scene_id: validators.number({ integer: true, min: 1 }),
            shot_id: validators.number({ integer: true, min: 1 }),
            model: validators.enum(['flux', 'flux_schnell']),
            prompt: validators.string({ maxLength: 2000 }),
        },
        required: ['project_id', 'scene_id', 'shot_id', 'prompt'],
    }),

    // 视频生成请求
    generateVideo: createValidator({
        fields: {
            project_id: validators.optional(validators.uuid()),
            shot_id: validators.optional(validators.number({ integer: true, min: 1 })),
            model: validators.string(),
            image_url: validators.optional(validators.url()),
            prompt: validators.string({ maxLength: 2000 }),
            aspect_ratio: validators.optional(validators.enum(['16:9', '9:16', '1:1', '4:3'])),
        },
        required: ['model', 'prompt'],
    }),

    // 批量生成图片
    batchGenImages: createValidator({
        fields: {
            project_id: validators.uuid(),
            scene_start: validators.number({ integer: true, min: 0 }),
            scene_end: validators.number({ integer: true, min: 0 }),
            shot_start: validators.number({ integer: true, min: 0 }),
            shot_end: validators.number({ integer: true, min: 0 }),
            model: validators.enum(['flux', 'flux_schnell']),
        },
        required: ['project_id', 'scene_start', 'scene_end'],
    }),

    // 批准故事板
    approveStoryboard: createValidator({
        fields: {
            project_id: validators.uuid(),
            shot_id: validators.number({ integer: true, min: 1 }),
        },
        required: ['project_id', 'shot_id'],
    }),

    // 验证故事板
    validateStoryboard: createValidator({
        fields: {
            project_id: validators.uuid(),
            shot_id: validators.number({ integer: true, min: 1 }),
        },
        required: ['project_id', 'shot_id'],
    }),
};

/**
 * 快速验证函数
 */
export function validateRequest<T>(
    data: any,
    schemaValidator: (data: any) => ValidationResult<T>
): { valid: true; data: T } | { valid: false; errors: { field: string; message: string }[] } {
    const result = schemaValidator(data);
    if (result.valid) {
        return { valid: true, data: result.data as T };
    }
    return { valid: false, errors: result.errors || [] };
}
