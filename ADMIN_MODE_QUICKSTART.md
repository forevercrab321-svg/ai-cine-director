# 🚀 Admin Mode 快速启动指南

## 概述

系统已经实现了**开发者自动识别功能**。在登入时，系统会自动检测邮箱是否属于开发者，并相应地设置权限。

---

## 5分钟快速开始

### 第1步：启动应用
```bash
cd /Users/monsterlee/Desktop/ai-cine-director
npm run dev:all
```

访问: http://localhost:3000

### 第2步：使用开发者邮箱登入
在登入页输入：
```
forevercrab321@gmail.com
```

### 第3步：观察自动识别
✨ **你会看到**：
- ✅ 绿色"开发者模式"指示器出现
- ✅ OTP 验证页显示"开发者账户 - 完整权限"
- ✅ 登入后 Header 显示绿色"Dev"徽章

### 第4步：验证权限
- 生成内容时**不消耗积分**
- 没有付费墙限制
- Settings 中显示 God Mode 已启用

---

## 和普通用户对比

### 使用普通邮箱再登入一次
```
user@example.com
```

**观察差异**：
- ❌ 无"开发者模式"指示器
- ❌ Header 仅显示蓝色"Pro"徽章
- ❌ 生成内容后触发付费墙
- ❌ 积分余额为 0

---

## 开发者邮箱列表

当前注册的开发者邮箱：
- `forevercrab321@gmail.com`

**使用该邮箱登入会自动激活 Admin Mode！**

---

## 添加新开发者（20秒）

### 编辑文件
打开: `context/AppContext.tsx`

找到（第 57-65 行）：
```typescript
const DEVELOPER_EMAILS = new Set([
  'monsterlee@gmail.com',
  'director@cine-ai.studio',
  // ... 其他邮箱
  'your-email@domain.com'  // ← 添加在这里
]);
```

### 保存并刷新
- 保存文件（Ctrl+S 或 Cmd+S）
- 刷新浏览器（F5）
- 使用新邮箱登入即可生效

---

## 故障排除

### 问题：邮箱登入后没有显示绿色"Dev"徽章

**原因可能**：
1. ❌ 邮箱未在 `DEVELOPER_EMAILS` 中
2. ❌ 邮箱拼写有误
3. ❌ 浏览器缓存

**解决方案**：
```javascript
// 在浏览器 Console 运行
localStorage.clear()  // 清除缓存
location.reload()     // 刷新页面
```

### 问题：修改后没有生效

**解决方案**：
```bash
# 停止应用
Ctrl+C

# 清除 node_modules 缓存
npm run dev:all
```

---

## 完整测试流程（10分钟）

```
┌─────────────────────────────────────────────┐
│ 第1部分：开发者登入流程                       │
└─────────────────────────────────────────────┘

1. 访问登入页 http://localhost:3000
   ↓
2. 输入开发者邮箱: monsterlee@gmail.com
   ↓
3. ✅ 观察绿色"开发者模式"指示器
   ↓
4. 点击"发送验证码"
   ↓
5. 检查邮箱获取 OTP
   ↓
6. ✅ 输入 OTP，观察"完整权限"提示
   ↓
7. 完善资料（名字、角色）
   ↓
8. ✅ 登入成功，Header 显示"Dev"徽章
   ↓
9. ✅ 生成内容不消耗积分
   ↓
10. ✅ Settings 显示 God Mode 已启用

┌─────────────────────────────────────────────┐
│ 第2部分：普通用户对比                         │
└─────────────────────────────────────────────┘

1. 点击 Header 的"登出"
   ↓
2. 输入普通邮箱: user@example.com
   ↓
3. ❌ 无"开发者模式"指示器
   ↓
4. 验证 OTP 并登入
   ↓
5. ❌ Header 仅显示"Pro"（无"Dev"）
   ↓
6. 尝试生成内容
   ↓
7. ✅ 触发付费墙（积分不足）

┌─────────────────────────────────────────────┐
│ 第3部分：功能验证                             │
└─────────────────────────────────────────────┘

登入为开发者后：
✅ 可无限生成视频和故事板
✅ 不受积分限制
✅ 不显示付费墙
✅ 可访问所有高级功能
```

---

## 调试技巧

### 查看控制台日志

打开 DevTools (F12) → Console 标签，查看：

**开发者登入时**：
```
[AUTH] Developer email detected: monsterlee@gmail.com
[ADMIN] User monsterlee@gmail.com detected as developer/admin
```

**普通用户登入时**：
```
[CREDIT GUARD] Auto-opened paywall: balance = 0
```

### 快速邮箱检查

在 Console 运行：
```javascript
// 检查邮箱是否是开发者
isDeveloperEmail('monsterlee@gmail.com')  // true
isDeveloperEmail('user@example.com')       // false
```

---

## 相关文档

| 文件 | 说明 |
|------|------|
| [ADMIN_MODE_DEBUG.md](ADMIN_MODE_DEBUG.md) | 📖 完整的调试指南 |
| [ADMIN_MODE_IMPLEMENTATION.md](ADMIN_MODE_IMPLEMENTATION.md) | 📋 技术实现细节 |
| [ADMIN_MODE_QUICKREF.md](ADMIN_MODE_QUICKREF.md) | ⚡ 快速参考卡 |
| [ADMIN_MODE_VERIFICATION.md](ADMIN_MODE_VERIFICATION.md) | ✅ 验证清单 |
| [test-admin-emails.js](test-admin-emails.js) | 🧪 单元测试脚本 |

---

## 源代码位置

| 功能 | 文件 | 位置 |
|------|------|------|
| 邮箱注册表 | context/AppContext.tsx | 第 57-65 行 |
| 检测函数 | context/AppContext.tsx | 第 67-70 行 |
| Auth 流程 | context/AppContext.tsx | 第 159-184 行 |
| 登入检测 | components/AuthPage.tsx | 第 78-82 行 |
| UI 指示器 | components/AuthPage.tsx | 第 145-152, 214-221 行 |
| Dev 徽章 | components/Header.tsx | 第 39-49 行 |

---

## 常见用例

### 用例 1：添加公司团队成员为开发者

```typescript
const DEVELOPER_EMAILS = new Set([
  'monsterlee@gmail.com',
  'team@mycompany.com',    // ← 添加
  'dev2@mycompany.com',    // ← 添加
]);
```

### 用例 2：临时禁用某个开发者

```typescript
const DEVELOPER_EMAILS = new Set([
  // 'disabled-user@company.com',  // ← 注释掉
  'monsterlee@gmail.com',
]);
```

### 用例 3：为客户启用 Demo 模式

```typescript
const DEVELOPER_EMAILS = new Set([
  'monsterlee@gmail.com',
  'demo@client.com',   // ← 临时演示账户
]);
```

---

## ⏱️ 时间表

| 步骤 | 时间 |
|------|------|
| 1. 启动应用 | 1分钟 |
| 2. 开发者登入 | 2分钟 |
| 3. 观察 UI | 1分钟 |
| 4. 普通用户对比 | 2分钟 |
| 5. 测试生成功能 | 2分钟 |
| **总计** | **10分钟** |

---

## 📞 获取帮助

遇到问题？

1. **查看文档**: [ADMIN_MODE_DEBUG.md](ADMIN_MODE_DEBUG.md)
2. **运行测试**: 复制 `test-admin-emails.js` 到 Console
3. **检查日志**: 打开 DevTools Console 查看 `[AUTH]` 和 `[ADMIN]` 日志
4. **清除缓存**: `localStorage.clear()` + 刷新

---

**现在就试试吧！使用 `monsterlee@gmail.com` 登入体验开发者模式！** 🎉

