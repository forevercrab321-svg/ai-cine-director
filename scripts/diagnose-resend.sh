#!/bin/bash

# Resend + Supabase SMTP 快速诊断脚本

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Resend + Supabase SMTP 快速诊断                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 询问用户信息
echo -e "${YELLOW}请输入你的信息（用于诊断）${NC}"
echo ""

read -p "1. 你的 Resend API Key (re_...): " API_KEY
read -p "2. 你的发件人邮箱 (例: noreply@resend.dev): " SENDER_EMAIL
read -p "3. 你看到的错误信息是什么？(或按 Enter 跳过): " ERROR_MSG

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 检查 1: API Key 格式
echo -e "${YELLOW}检查 1: API Key 格式${NC}"
if [[ $API_KEY == re_* ]]; then
  echo -e "${GREEN}✅ API Key 格式正确${NC}"
else
  echo -e "${RED}❌ API Key 格式错误 (必须以 re_ 开头)${NC}"
  echo -e "${YELLOW}   你的 Key: ${API_KEY:0:10}...${NC}"
fi
echo ""

# 检查 2: API Key 有效性
echo -e "${YELLOW}检查 2: 验证 API Key 是否有效${NC}"
RESPONSE=$(curl -s -X GET "https://api.resend.com/api_keys" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" 2>/dev/null)

if echo "$RESPONSE" | grep -q '"data"'; then
  echo -e "${GREEN}✅ Resend API Key 有效${NC}"
elif echo "$RESPONSE" | grep -q "Unauthorized\|unauthorized"; then
  echo -e "${RED}❌ API Key 无效或已过期${NC}"
  echo -e "${YELLOW}   解决: 到 https://resend.com/api-keys 重新生成${NC}"
else
  echo -e "${YELLOW}⚠️  无法验证 (可能是网络问题)${NC}"
  echo -e "${YELLOW}   Response: ${RESPONSE:0:100}...${NC}"
fi
echo ""

# 检查 3: 发件人邮箱验证状态
echo -e "${YELLOW}检查 3: 验证发件人邮箱${NC}"
DOMAIN_RESPONSE=$(curl -s -X GET "https://api.resend.com/domains" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" 2>/dev/null)

if echo "$DOMAIN_RESPONSE" | grep -q "$SENDER_EMAIL"; then
  echo -e "${GREEN}✅ 发件人邮箱已在 Resend 中验证${NC}"
elif [[ "$SENDER_EMAIL" == "noreply@resend.dev" ]]; then
  echo -e "${GREEN}✅ 使用 Resend 默认域名 (无需单独验证)${NC}"
else
  echo -e "${YELLOW}⚠️  发件人邮箱未找到${NC}"
  echo -e "${YELLOW}   请在 Resend Dashboard 中验证: $SENDER_EMAIL${NC}"
  echo -e "${YELLOW}   或使用: noreply@resend.dev${NC}"
fi
echo ""

# 检查 4: SMTP 连接测试
echo -e "${YELLOW}检查 4: SMTP 连接测试${NC}"
if command -v nc &> /dev/null; then
  nc -zv smtp.resend.com 465 2>&1 | grep -q "succeeded\|Connection"
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 可以连接到 smtp.resend.com:465${NC}"
  else
    echo -e "${RED}❌ 无法连接到 smtp.resend.com:465${NC}"
    echo -e "${YELLOW}   解决: 检查你的防火墙和网络连接${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  nc 命令不可用，跳过连接测试${NC}"
fi
echo ""

# 检查 5: 常见错误检查
echo -e "${YELLOW}检查 5: 常见问题分析${NC}"

if [ -n "$ERROR_MSG" ]; then
  echo "你的错误信息: $ERROR_MSG"
  echo ""
  
  if echo "$ERROR_MSG" | grep -qi "unauthorized\|invalid"; then
    echo -e "${RED}  问题: API Key 无效${NC}"
    echo -e "${BLUE}  解决:${NC}"
    echo -e "    1. 到 https://resend.com/api-keys"
    echo -e "    2. 生成新的 API Key"
    echo -e "    3. 复制完整 API Key (包括 re_ 前缀)"
  fi
  
  if echo "$ERROR_MSG" | grep -qi "connection\|refused\|timeout"; then
    echo -e "${RED}  问题: 无法连接到 SMTP 服务器${NC}"
    echo -e "${BLUE}  解决:${NC}"
    echo -e "    1. 检查 Host: smtp.resend.com"
    echo -e "    2. 检查 Port: 465 (不要用 587)"
    echo -e "    3. 检查网络防火墙是否开放 465 端口"
  fi
  
  if echo "$ERROR_MSG" | grep -qi "authentication\|password\|username"; then
    echo -e "${RED}  问题: 用户名或密码错误${NC}"
    echo -e "${BLUE}  解决:${NC}"
    echo -e "    Username 必须填: default"
    echo -e "    Password 必须填: 你的完整 API Key (re_...)"
  fi
  
  if echo "$ERROR_MSG" | grep -qi "verify\|verified\|not found"; then
    echo -e "${RED}  问题: 发件人邮箱未验证${NC}"
    echo -e "${BLUE}  解决:${NC}"
    echo -e "    1. 到 https://resend.com/domains"
    echo -e "    2. 添加或验证域名"
    echo -e "    3. 等待验证完成"
    echo -e "    4. 或使用: noreply@resend.dev (已预验证)"
  fi
else
  echo -e "${GREEN}✅ 没有报告错误信息${NC}"
  echo -e "${YELLOW}   如果你准备好了，请填写以下信息到 Supabase:${NC}"
  echo ""
  echo -e "${BLUE}    Sender email: $SENDER_EMAIL${NC}"
  echo -e "${BLUE}    Sender name: AI Cine Director${NC}"
  echo -e "${BLUE}    Host: smtp.resend.com${NC}"
  echo -e "${BLUE}    Port: 465${NC}"
  echo -e "${BLUE}    Username: default${NC}"
  echo -e "${BLUE}    Password: $API_KEY${NC}"
fi
echo ""

# 总结
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}诊断完成！${NC}"
echo ""
echo -e "${GREEN}下一步:${NC}"
echo "  1. 确保上面所有检查都是 ✅"
echo "  2. 在 Supabase Dashboard 中填写上面的信息"
echo "  3. 点击 'Save' 保存"
echo "  4. 等待验证完成 (10-30 秒)"
echo "  5. 在 Email Templates 中点击 'Send test email' 测试"
echo ""
echo -e "${BLUE}需要帮助? 查看: RESEND_SMTP_TROUBLESHOOTING.md${NC}"
