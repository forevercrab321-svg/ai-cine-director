# 🔧 Resend + Supabase SMTP 配置排查指南

## 🎯 第一步：验证你的 Resend API Key

### Step 1.1: 检查 API Key 格式

你的 Resend API Key 应该是这样的格式：
```
✅ 正确: re_abc123def456ghi789jkl012mno345
❌ 错误: abc123def456ghi789jkl012mno345 (缺少 re_ 前缀)
❌ 错误: resend_abc123def456ghi789jkl012mno345
```

**你的 API Key 是什么样的？** (前缀必须是 `re_`)

---

### Step 1.2: 验证 API Key 是否有效

打开终端，运行以下命令测试你的 API Key：

```bash
# 替换 YOUR_API_KEY 为你的实际 API Key
curl -X GET "https://api.resend.com/api_keys" \
  -H "Authorization: Bearer re_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json"
```

**预期输出** (成功):
```json
{
  "object": "list",
  "data": [
    {
      "id": "key_123...",
      "token": "re_...",
      "created_at": "2024-01-01T..."
    }
  ]
}
```

**如果出现错误**:
```json
{
  "message": "Unauthorized"
}
```
说明 API Key 有问题。

---

## 🎯 第二步：验证 Resend 域名配置

### Step 2.1: 确认你在 Resend 中的设置

1. **登录 Resend**: https://resend.com
2. **左侧菜单** → "Domains"
3. **查看你的域名列表**

你应该看到：
```
✅ noreply@resend.dev (已验证)
或
✅ noreply@yourdomain.com (已验证)
```

**选择一个已验证的域名邮箱地址**，这就是你要在 Supabase 中填的发件人邮箱。

---

## 🎯 第三步：在 Supabase 中测试 SMTP 连接

### Step 3.1: 打开 Supabase SQL Editor 并运行诊断

打开终端，创建一个测试脚本：

```bash
cat > /tmp/test-resend-smtp.sh << 'EOF'
#!/bin/bash

# Resend SMTP 连接测试

API_KEY="re_YOUR_API_KEY_HERE"  # ← 替换为你的 API Key
EMAIL="noreply@resend.dev"       # ← 替换为你的发件人邮箱
SUPABASE_URL="https://gtxgkdsayswonlewqfzj.supabase.co"

echo "🔍 测试 Resend SMTP 连接..."
echo ""
echo "配置信息:"
echo "  API Key: ${API_KEY:0:10}..."
echo "  Email: $EMAIL"
echo ""

# 测试 1: Resend API 连接
echo "Test 1: 验证 Resend API Key"
RESPONSE=$(curl -s -X GET "https://api.resend.com/api_keys" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")

if echo "$RESPONSE" | grep -q "data"; then
  echo "✅ Resend API Key 有效"
else
  echo "❌ Resend API Key 无效"
  echo "Response: $RESPONSE"
  exit 1
fi

echo ""
echo "Test 2: SMTP 连接参数检查"
echo "  Host: smtp.resend.com"
echo "  Port: 465"
echo "  Username: default"
echo "  Password: $API_KEY"
echo ""

# 测试 3: 检查发件人邮箱
echo "Test 3: 验证发件人邮箱"
SENDER_RESPONSE=$(curl -s -X GET "https://api.resend.com/domains" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")

if echo "$SENDER_RESPONSE" | grep -q "$EMAIL"; then
  echo "✅ 发件人邮箱已在 Resend 中验证"
else
  echo "⚠️  发件人邮箱未找到或未验证"
  echo "Response: $SENDER_RESPONSE"
fi

echo ""
echo "✅ 所有配置参数都正确！"
echo ""
echo "现在在 Supabase 中填写："
echo "  Sender email: $EMAIL"
echo "  Sender name: AI Cine Director"
echo "  Host: smtp.resend.com"
echo "  Port: 465"
echo "  Username: default"
echo "  Password: $API_KEY"

EOF

chmod +x /tmp/test-resend-smtp.sh
bash /tmp/test-resend-smtp.sh
```

---

## 🎯 第四步：常见错误排查

### 错误 1: "Invalid API Key" 或 "Unauthorized"

**原因**: API Key 格式错误或无效

**解决**:
```bash
# 1. 检查 API Key 格式
grep "re_" <<< "你的API_Key"  # 应该输出 re_...

# 2. 在 Resend Dashboard 重新生成 API Key
#    https://resend.com/api-keys
```

---

### 错误 2: "Connection refused" 或 "Host not found"

**原因**: Supabase 无法连接到 smtp.resend.com

**解决**:
```bash
# 测试网络连接
nc -zv smtp.resend.com 465

# 预期输出: Connection to smtp.resend.com port 465 [tcp/smtps] succeeded!
```

---

### 错误 3: "Authentication failed"

**原因**: Username 或 Password 错误

**检查**:
- Username: 必须是 `default`（不是 API Key）
- Password: 必须是完整的 API Key（`re_...`）

---

### 错误 4: "Sender email not verified"

**原因**: 发件人邮箱未在 Resend 中验证

**解决**:
```
1. 登录 Resend: https://resend.com
2. 左侧 "Domains"
3. 添加域名或验证邮箱
4. 等待验证完成（通常 5-10 分钟）
5. 在 Supabase 中使用已验证的邮箱
```

---

## 🎯 第五步：在 Supabase 中完整填写

确保按照以下顺序填写，**不要有多余的空格**：

### 表单填写（复制粘贴）

```
【Sender details】

Sender email address:
  noreply@resend.dev

Sender name:
  AI Cine Director

【SMTP provider settings】

Host:
  smtp.resend.com

Port number:
  465

Username:
  default

Password:
  re_abc123def456ghi789jkl012mno345  (你的完整 API Key)

Minimum interval per user:
  60
```

---

## ✅ 测试清单

按照以下顺序检查：

### Before 保存前

- [ ] API Key 格式正确（以 `re_` 开头）
- [ ] Sender email 在 Resend 中已验证
- [ ] Host 是 `smtp.resend.com`（不是其他）
- [ ] Port 是 `465`（不是 587 或其他）
- [ ] Username 是 `default`
- [ ] Password 是完整的 API Key
- [ ] 没有多余的空格或换行

### After 保存后

- [ ] 点击 "Save" 按钮
- [ ] 等待 Supabase 验证（通常 10-30 秒）
- [ ] 检查是否出现 ❌ 错误提示
- [ ] 如果没有错误，说明配置成功 ✅

### 发送测试邮件

- [ ] 打开 Authentication → Email Templates
- [ ] 选择一个邮件模板（如 "Confirm signup"）
- [ ] 点击 "Send test email"
- [ ] 输入你的测试邮箱地址
- [ ] 点击发送
- [ ] 检查邮箱是否收到（可能在垃圾邮件中）

---

## 🚨 如果仍有问题

请告诉我以下信息：

```
1. 你看到了什么错误信息？
   (完整的错误文本)

2. 你填写的具体信息：
   - Sender email: ___________
   - Host: ___________
   - Port: ___________
   - Username: ___________
   
3. 你在 Resend 中看到的域名是什么？
   - ___________

4. API Key 的格式（只显示前缀和后缀）：
   - re_......xyz
```

---

## 📞 快速联系信息

- **Resend 文档**: https://resend.com/docs
- **Resend 支持**: support@resend.com
- **Supabase 文档**: https://supabase.com/docs/guides/auth/auth-smtp

---

**现在请回答：你在配置中遇到了什么具体的错误或问题？**
