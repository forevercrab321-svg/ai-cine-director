#!/bin/bash

# ====================================================================
# Supabase 完整诊断脚本
# ====================================================================

set -e

PROJECT_ROOT="/Users/monsterlee/Desktop/ai-cine-director"
cd "$PROJECT_ROOT"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔍 Supabase 完整诊断${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ====================================================================
# 1. 验证环境变量
# ====================================================================

echo -e "${YELLOW}Step 1: 验证环境变量${NC}"
echo ""

if [ ! -f ".env.local" ]; then
  echo -e "${RED}❌ .env.local 不存在${NC}"
  exit 1
fi

SUPABASE_URL=$(grep "VITE_SUPABASE_URL" .env.local | cut -d'=' -f2 | tr -d ' ')
ANON_KEY=$(grep "VITE_SUPABASE_ANON_KEY" .env.local | cut -d'=' -f2 | tr -d ' ')
SERVICE_KEY=$(grep "SUPABASE_SERVICE_ROLE_KEY" .env.local | cut -d'=' -f2 | tr -d ' ')

if [ -z "$SUPABASE_URL" ]; then
  echo -e "${RED}❌ VITE_SUPABASE_URL 未设置${NC}"
  exit 1
fi

if [ -z "$ANON_KEY" ]; then
  echo -e "${RED}❌ VITE_SUPABASE_ANON_KEY 未设置${NC}"
  exit 1
fi

if [ -z "$SERVICE_KEY" ]; then
  echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY 未设置${NC}"
  exit 1
fi

echo -e "${GREEN}✅ VITE_SUPABASE_URL: ${SUPABASE_URL}${NC}"
echo -e "${GREEN}✅ VITE_SUPABASE_ANON_KEY: ${ANON_KEY:0:20}...${NC}"
echo -e "${GREEN}✅ SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_KEY:0:20}...${NC}"
echo ""

# ====================================================================
# 2. 测试 API 连接
# ====================================================================

echo -e "${YELLOW}Step 2: 测试 Supabase API 连接${NC}"
echo ""

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  "${SUPABASE_URL}/rest/v1/")

if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "404" ] || [ "$HEALTH" = "401" ]; then
  echo -e "${GREEN}✅ Supabase API 可访问 (HTTP $HEALTH)${NC}"
else
  echo -e "${RED}❌ Supabase API 不可访问 (HTTP $HEALTH)${NC}"
  exit 1
fi
echo ""

# ====================================================================
# 3. 检查数据库表
# ====================================================================

echo -e "${YELLOW}Step 3: 检查数据库表${NC}"
echo ""

check_table() {
  local table_name=$1
  local response=$(curl -s \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPABASE_URL}/rest/v1/${table_name}?limit=0&select=*" \
    2>/dev/null)
  
  if echo "$response" | grep -q "error\|404"; then
    echo -e "${RED}❌ ${table_name} 表不存在${NC}"
    return 1
  else
    echo -e "${GREEN}✅ ${table_name} 表存在${NC}"
    return 0
  fi
}

TABLES_OK=true
for table in profiles storyboards scenes; do
  if ! check_table "$table"; then
    TABLES_OK=false
  fi
done

echo ""

if [ "$TABLES_OK" = false ]; then
  echo -e "${YELLOW}⚠️  某些表不存在，需要运行初始化脚本${NC}"
  echo -e "${YELLOW}📝 运行步骤:${NC}"
  echo -e "  1. 打开: https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql"
  echo -e "  2. 新建 Query"
  echo -e "  3. 复制并运行: supabase/init-schema.sql"
  echo ""
fi

# ====================================================================
# 4. 检查 RLS 策略
# ====================================================================

echo -e "${YELLOW}Step 4: 检查 RLS 策略${NC}"
echo ""

POLICIES=$(curl -s \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  "${SUPABASE_URL}/rest/v1/pg_policies?select=*&schemaname=eq.public" \
  2>/dev/null | grep -o 'policyname' | wc -l)

if [ "$POLICIES" -gt 0 ]; then
  echo -e "${GREEN}✅ 找到 $POLICIES 个 RLS 策略${NC}"
else
  echo -e "${YELLOW}⚠️  未找到 RLS 策略${NC}"
fi
echo ""

# ====================================================================
# 5. 检查 Trigger
# ====================================================================

echo -e "${YELLOW}Step 5: 检查 Trigger${NC}"
echo ""

TRIGGERS=$(curl -s \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  "${SUPABASE_URL}/rest/v1/pg_trigger?select=*&tgname=eq.on_auth_user_created" \
  2>/dev/null | grep -o '"tgname"' | wc -l)

if [ "$TRIGGERS" -gt 0 ]; then
  echo -e "${GREEN}✅ 找到 trigger: on_auth_user_created${NC}"
else
  echo -e "${YELLOW}⚠️  未找到 trigger: on_auth_user_created${NC}"
  echo -e "${YELLOW}   新用户注册时可能无法自动创建 profile 和积分${NC}"
fi
echo ""

# ====================================================================
# 6. 测试数据查询
# ====================================================================

echo -e "${YELLOW}Step 6: 测试数据查询${NC}"
echo ""

PROFILE_COUNT=$(curl -s \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Prefer: count=exact" \
  "${SUPABASE_URL}/rest/v1/profiles?select=count" \
  2>/dev/null | head -c 1)

if [ -n "$PROFILE_COUNT" ]; then
  echo -e "${GREEN}✅ 可以查询 profiles 表${NC}"
  echo -e "   当前记录数: $PROFILE_COUNT"
else
  echo -e "${YELLOW}⚠️  无法查询 profiles 表 (可能需要 RLS 配置)${NC}"
fi
echo ""

# ====================================================================
# 总结
# ====================================================================

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 诊断完成！${NC}"
echo ""
echo -e "${YELLOW}📋 检查清单:${NC}"
echo -e "  ✓ 环境变量已配置"
echo -e "  ✓ API 连接正常"
if [ "$TABLES_OK" = true ]; then
  echo -e "  ✓ 数据库表已创建"
else
  echo -e "  ✗ 需要创建数据库表"
fi
if [ "$POLICIES" -gt 0 ]; then
  echo -e "  ✓ RLS 策略已配置"
else
  echo -e "  ✗ RLS 策略未配置"
fi
if [ "$TRIGGERS" -gt 0 ]; then
  echo -e "  ✓ Trigger 已创建"
else
  echo -e "  ✗ Trigger 未创建"
fi
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
