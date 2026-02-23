# 📌 Supabase Debug 继续 - 快速参考

## 🎯 核心问题

你的 Supabase 配置缺少 **2 个关键部分**：

| 问题 | 状态 | 影响 |
|------|------|------|
| RLS 策略 | ⚠️ 缺失 | 用户可看到彼此数据（安全风险！） |
| Trigger | ⚠️ 缺失 | 新用户无法自动创建 profile（应用崩溃） |
| SMTP 邮件 | ✅ 已配置 | 无需更改，默认即可 |

---

## ⚡ 5分钟快速修复

### 1️⃣ 打开 SQL 编辑器
```
https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql
```

### 2️⃣ 复制以下 SQL 并运行

见文件: **[SUPABASE_QUICK_FIX.md](SUPABASE_QUICK_FIX.md)**

或打开: **[supabase/quick-fix.html](supabase/quick-fix.html)** 在浏览器中一键复制

### 3️⃣ 验证修复
```bash
bash /Users/monsterlee/Desktop/ai-cine-director/scripts/diagnose-supabase-complete.sh
```

### 4️⃣ 启动应用
```bash
cd /Users/monsterlee/Desktop/ai-cine-director
npm run dev:all
```

### 5️⃣ 测试
1. 打开 http://localhost:3000
2. 注册新用户
3. ✅ 应该看到 50 积分

---

## 📧 关于你看到的邮件配置

### 你的截图显示
```
Supabase Dashboard → Authentication → Email
"Enable custom SMTP" 按钮，需要填写信息
```

### 不用担心！✅
- Supabase 默认使用自己的邮件服务
- **不需要配置自定义 SMTP**
- 邮件功能已正常工作
- 只有当你想用自己的邮件服务器才需要配置

---

## 📁 为你创建的文件

### 快速启动 (选一个)
1. **[SUPABASE_QUICK_FIX.md](SUPABASE_QUICK_FIX.md)** ← 推荐 (纯文本)
2. **[supabase/quick-fix.html](supabase/quick-fix.html)** ← 最简单 (在浏览器打开)

### 详细文档
- [SUPABASE_FIX_RLS_AND_TRIGGER.md](SUPABASE_FIX_RLS_AND_TRIGGER.md) - 详细步骤
- [SUPABASE_SETUP_GUIDE.md](SUPABASE_SETUP_GUIDE.md) - 完整配置
- [SUPABASE_DIAGNOSIS_SUMMARY.md](SUPABASE_DIAGNOSIS_SUMMARY.md) - 诊断结果

### 工具和脚本
- [scripts/diagnose-supabase-complete.sh](scripts/diagnose-supabase-complete.sh) - 诊断脚本
- [supabase/init-schema.sql](supabase/init-schema.sql) - 完整 Schema
- [supabase/FIXES.json](supabase/FIXES.json) - SQL 脚本集合

---

## 🔍 当前诊断结果

```
✅ 环境变量已配置
✅ API 连接正常  
✅ 数据库表已创建 (profiles, storyboards, scenes)
✅ Email 邮件已配置（默认 Supabase）
⚠️  RLS 策略未配置 → 需要修复
⚠️  Trigger 未创建 → 需要修复
```

---

## 🎯 立即行动

### 最简单的方式 (推荐)
1. 打开 `supabase/quick-fix.html` 在浏览器中
2. 点击 "复制所有 SQL"
3. 粘贴到 Supabase SQL Editor 并运行

### 或者
1. 打开 `SUPABASE_QUICK_FIX.md`
2. 复制 SQL 代码
3. 粘贴到 Supabase SQL Editor 并运行

### 然后
```bash
# 验证
bash /Users/monsterlee/Desktop/ai-cine-director/scripts/diagnose-supabase-complete.sh

# 启动
npm run dev:all
```

---

## ✅ 预期结果

修复完成后：
- ✅ 新用户能正常注册
- ✅ 自动获得 50 积分  
- ✅ 用户只能看到自己的数据
- ✅ 应用完全正常工作

---

**所需时间**: 5 分钟
**难度**: ⭐ (非常简单)
**关键文件**: SUPABASE_QUICK_FIX.md 或 supabase/quick-fix.html
