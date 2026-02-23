# Admin Mode Debug Guide

## 概述

该系统实现了**自动开发者识别** - 在登入时自动检测开发者邮箱并授予完整的 admin 权限（God Mode），与普通用户区分开。

---

## 系统设计

### 1. 开发者邮箱注册表（AppContext.tsx）

```typescript
// 在 AppContext.tsx 中定义
const DEVELOPER_EMAILS = new Set([
  'monsterlee@gmail.com',
  'director@cine-ai.studio',
  'producer@cine-ai.studio',
  'art@cine-ai.studio',
  'writer@cine-ai.studio',
  'admin@cine-ai.studio',
  'dev@cine-ai.studio',
  'test@cine-ai.studio'
]);

const isDeveloperEmail = (email: string): boolean => {
  return DEVELOPER_EMAILS.has(email?.toLowerCase());
};
```

### 2. 认证流程（AppContext.tsx）

**步骤 1**: 用户在 AuthPage 输入邮箱
- AuthPage 调用 `isDeveloperEmail(email)` 检测是否是开发者邮箱
- 如果是开发者，UI 显示 "开发者模式" 指示器（翠绿色）

**步骤 2**: 用户验证 OTP
- 如果是开发者，OTP 步骤显示 "开发者账户 - 完整权限" 提示

**步骤 3**: 用户登入后（AppContext.fetchProfile）
```typescript
const isDeveloper = userEmail ? isDeveloperEmail(userEmail) : data.is_admin;

if (isGodMode || isDeveloper || data.is_admin) {
  // 自动授予无限额度 + admin 权限
  balanceRef.current = 999999;
  setUserState({
    balance: 999999,
    isPro: true,
    isAdmin: true,  // ✅ 自动激活 admin
    monthlyUsage: 0,
    planType: 'director'
  });
  console.log(`[ADMIN] User ${userEmail} detected as developer/admin`);
}
```

### 3. UI 指示器（Header.tsx）

Header 显示 "Dev" 徽章，区别于普通用户：

```tsx
{userState.isAdmin && <span className="...">Dev</span>}
```

---

## 功能对比：开发者 vs 普通用户

| 功能 | 开发者 | 普通用户 |
|------|--------|---------|
| **登入识别** | 邮箱在 `DEVELOPER_EMAILS` | 需要 Stripe 购买积分 |
| **积分额度** | 999,999（无限） | 需要购买 |
| **Admin 权限** | ✅ 自动启用 | ❌ 无 |
| **头部徽章** | "Dev" (翠绿) | "Pro" (靛蓝) |
| **God Mode** | 自动激活 | 需要密码 |
| **UI 指示器** | 登入时显示"开发者模式" | 无 |

---

## 如何测试

### 方法 1：使用注册的开发者邮箱

1. **启动应用**
   ```bash
   npm run dev:all
   ```

2. **在登入页输入开发者邮箱**
   - 输入：`monsterlee@gmail.com`（或任何在 `DEVELOPER_EMAILS` 中的邮箱）
   - 观察：应该看到 **翠绿色 "开发者模式" 指示器**

3. **验证 OTP**
   - 检查邮箱获取验证码
   - 验证后应该看到 **"开发者账户 - 完整权限" 提示**

4. **完善资料**
   - 选择名称和角色后登入

5. **验证状态**
   - Header 显示 **"Dev"** 徽章（翠绿色）
   - 用户可以无限生成内容（不消耗积分）
   - SettingsModal 中可看到 God Mode 已激活

### 方法 2：使用普通邮箱对比

1. **使用非开发者邮箱登入**
   - 输入：`user@example.com`
   - 观察：**无 "开发者模式" 指示器**

2. **验证 OTP 并登入**
   - Header 仅显示 **"Pro"** 徽章（靛蓝色）
   - **不显示 "Dev" 徽章**
   - 尝试生成内容会触发付费墙（因为积分为 0）

---

## 添加新开发者邮箱

编辑 `context/AppContext.tsx`:

```typescript
const DEVELOPER_EMAILS = new Set([
  'monsterlee@gmail.com',
  // ... 现有邮箱
  'newdev@yourdomain.com'  // ✅ 添加新开发者邮箱
]);
```

重启应用后立即生效。

---

## 调试日志

打开浏览器 DevTools Console，观察以下日志：

### 开发者登入时
```
[AUTH] Developer email detected: monsterlee@gmail.com
[ADMIN] User monsterlee@gmail.com detected as developer/admin
isGodMode: false, isDeveloper: true, dbAdmin: false
```

### 普通用户登入时
```
[AUTH] 不会出现开发者日志
balance: 0, isPro: false, isAdmin: false
```

### 自动付费墙触发
```
[CREDIT GUARD] Auto-opened paywall: balance = 0
```

---

## 权限检查代码位置

1. **邮箱识别**: [AppContext.tsx](context/AppContext.tsx#L57-L61)
2. **Auth 流程**: [AppContext.tsx](context/AppContext.tsx#L125-L155)
3. **登入检测**: [AuthPage.tsx](components/AuthPage.tsx#L85-L93)
4. **UI 指示器**: 
   - [Header.tsx](components/Header.tsx#L39-L49) - "Dev" 徽章
   - [AuthPage.tsx](components/AuthPage.tsx#L145-L152) - 登入时的指示器

---

## 故障排除

### 问题：开发者邮箱登入后仍显示 "Pro"（无 "Dev" 徽章）

**可能原因**：
1. 邮箱拼写错误或未在 `DEVELOPER_EMAILS` 中
2. 缓存问题

**解决方案**：
- 检查 `isDeveloperEmail()` 是否正确
- 清除 LocalStorage：`localStorage.clear()`
- 重新刷新页面

### 问题：开发者登入后仍触发付费墙

**可能原因**：
- `isDeveloperEmail()` 返回 false
- 邮箱大小写不一致

**解决方案**：
- 打开 DevTools Console，运行：
  ```javascript
  console.log(isDeveloperEmail('your@email.com'));
  ```
- 检查邮箱是否在 `DEVELOPER_EMAILS` 中

### 问题：想临时使用 God Mode（不是开发者）

**方案**：使用 SettingsModal 密码（v3.1）
- 打开 Settings 图标
- 点击版本号 5 次
- 输入密码：`admin2026`
- 点击 "Enable God Mode"

---

## 总结

✅ **自动识别**：开发者邮箱在登入时自动识别  
✅ **无缝激活**：自动启用 God Mode 和 admin 权限  
✅ **清晰标识**：UI 显示 "Dev" 徽章区别于普通用户  
✅ **可扩展**：轻松添加新开发者邮箱到注册表  
✅ **调试友好**：详细的控制台日志帮助排查问题  

