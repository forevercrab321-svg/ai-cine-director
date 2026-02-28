# Prompt Engine 版本切换与扩展说明

## 切换 v1/v2

- 默认使用 v1（原有 prompt 拼接逻辑）。
- 切换到新版 v2（结构化导演提示）：
  - 在 .env.local 或部署环境中加入：
    PROMPT_ENGINE_VERSION=v2
  - 重启服务后生效。
- 回退到 v1：
  - 设置 PROMPT_ENGINE_VERSION=v1 或删除该变量。

## 新增/扩展风格预设（Presets）

1. 打开 lib/promptEngine/promptEngine.ts
2. 在 VIDEO_PROMPT_PRESETS 对象中新增一个 preset，例如：

```
anime_epic: {
  shotType: 'Dynamic anime angles',
  lighting: 'Cel-shaded, dramatic',
  colorGrade: 'Vivid, high contrast',
  texture: 'Clean lines, painterly',
  negatives: ['muddy', 'uncanny', 'photorealism'],
},
```
3. 前端如需支持 UI 选择，只需传递 stylePreset 字符串。

## 对比测试

- 运行脚本：
  npx tsx scripts/testPromptEngine.ts
- 可对比同一输入下 v1/v2 prompt 差异。

## 兼容性说明
- v1/v2 版本切换不会影响 credits、鉴权、API 路由、数据库结构。
- 任何外部接口、字段、计费逻辑均保持不变。
