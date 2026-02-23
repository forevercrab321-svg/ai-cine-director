# Admin Mode 快速参考卡

## 📌 核心概念

**开发者（Developer）** = 在登入时自动激活 Admin Mode 的特殊用户

---

## ⚙️ 配置

### 添加开发者邮箱

文件: `context/AppContext.tsx` (第 57-65 行)

```typescript
const DEVELOPER_EMAILS = new Set([
  'your-email@domain.com',  // ← 添加在这里
]);
```

---

## 🎬 登入流程

```
邮箱输入
  ↓
[自动检查] isDeveloperEmail(email)?
  ├─ ✅ 是  → 显示"开发者模式"(翠绿指示器)
  │        → OTP页显示"完整权限"
  │        → AppContext 设置 isAdmin=true
  │        → Header 显示"Dev"徽章
  │
  └─ ❌ 否  → 正常登入流程
             → 触发付费墙
             → 仅显示"Pro"徽章
```

---

## 👥 用户类型对比

| | 开发者 | 普通用户 |
|---|--------|---------|
| **邮箱** | 在 DEVELOPER_EMAILS | 普通邮箱 |
| **Admin** | ✅ 自动启用 | ❌ |
| **积分** | ∞ (999,999) | $0 |
| **头部标签** | Dev (绿) + Pro | Pro (蓝) |
| **指示器** | 显示"开发者模式" | 无 |

---

## 🧪 快速测试

### 使用开发者邮箱
```
使用邮箱登入: forevercrab321@gmail.com
预期结果:
  ✅ 看到翠绿"开发者模式"
  ✅ Header 显示"Dev"徽章
  ✅ 无限生成权限
```

### 使用普通邮箱
```
使用邮箱登入: user@example.com
预期结果:
  ✅ 无指示器
  ✅ Header 仅显示"Pro"
  ✅ 触发付费墙
```

---

## 🔧 调试命令

### 浏览器 Console
```javascript
// 检查邮箱是否是开发者
isDeveloperEmail('your@email.com')  // 返回 true/false

// 查看开发者列表
Array.from(DEVELOPER_EMAILS)

// 清除 God Mode
localStorage.removeItem('ai_cine_god_mode')

// 刷新
location.reload()
```

---

## 📂 相关文件

| 文件 | 用途 |
|------|------|
| `context/AppContext.tsx` | 核心逻辑 + DEVELOPER_EMAILS |
| `components/AuthPage.tsx` | 登入 UI + 检测 |
| `components/Header.tsx` | Dev 徽章显示 |
| `ADMIN_MODE_DEBUG.md` | 完整指南 |
| `test-admin-emails.js` | 测试脚本 |

---

## 🚨 常见问题

### Q: 开发者邮箱登入后没有显示"Dev"？

A: 检查以下内容：
1. 邮箱是否在 `DEVELOPER_EMAILS` 中？
2. 邮箱是否大小写一致？
3. 是否清除了浏览器缓存？

```javascript
// Console 检查
isDeveloperEmail('your@email.com')  // 应返回 true
localStorage.clear()
location.reload()
```

---

### Q: 如何为某个用户临时禁用开发者身份？

A: 从 `DEVELOPER_EMAILS` 中移除邮箱：

```typescript
const DEVELOPER_EMAILS = new Set([
  // 'disabled-user@example.com',  // ← 注释掉
  'other@example.com'
]);
```

---

### Q: 普通用户如何测试 God Mode？

A:
1. 打开 Settings ⚙️
2. 点击版本号 5 次
3. 输入密码：`admin2026`
4. 点击"Enable God Mode"

---

## 💡 提示

- **批量添加开发者**: 直接修改 `DEVELOPER_EMAILS` Set，重启应用生效
- **邮箱大小写**: 系统自动转换为小写，所以大小写无关
- **持久化**: 开发者身份保存在 Supabase profiles 表的 `is_admin` 字段
- **备份方案**: 如果系统宕机，已认证的开发者在 DB 中标记为 admin，下次登入仍有权限

---

## 📊 日志标记

### 开发者相关日志
- `[AUTH]` - 登入时检测邮箱
- `[ADMIN]` - 自动激活 admin 模式
- `[CREDIT GUARD]` - 积分检查

### 查看日志
打开 DevTools → Console → Filter: `[AUTH]` 或 `[ADMIN]`

---

## 🔗 快速链接

- 📖 [完整文档](ADMIN_MODE_DEBUG.md)
- 📋 [实现细节](ADMIN_MODE_IMPLEMENTATION.md)
- 🧪 [测试脚本](test-admin-emails.js)

---

**最后更新**: 2026-02-22  
**系统版本**: SaaS Edition v3.1
