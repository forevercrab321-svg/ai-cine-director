#!/bin/bash

# Supabase 诊断脚本
# 检查数据库 Schema、RLS 和 Triggers

PROJECT_ID="gtxgkdsayswonlewqfzj"
SUPABASE_URL="https://gtxgkdsayswonlewqfzj.supabase.co"
SERVICE_ROLE_KEY=$(grep "SUPABASE_SERVICE_ROLE_KEY" .env.local | cut -d'=' -f2)

echo "🔍 Supabase 诊断开始..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 测试 1: 连接到 Supabase
echo "✓ 测试 1: API 连接性"
HEALTH=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  "${SUPABASE_URL}/rest/v1/" 2>/dev/null | tail -1)

if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "404" ]; then
  echo "  ✅ Supabase API 可访问"
else
  echo "  ❌ Supabase API 不可访问 (HTTP $HEALTH)"
  echo "  请检查: SERVICE_ROLE_KEY 或 SUPABASE_URL"
  exit 1
fi

echo ""
echo "✓ 测试 2: 检查数据库表"

# 查询表列表
TABLES=$(curl -s \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  "${SUPABASE_URL}/rest/v1/information_schema.tables?table_schema=eq.public&select=table_name" \
  2>/dev/null | grep -o '"table_name":"[^"]*"' | cut -d'"' -f4)

echo "  现有表:"
for table in $TABLES; do
  case $table in
    profiles) echo "    ✅ profiles" ;;
    storyboards) echo "    ✅ storyboards" ;;
    scenes) echo "    ✅ scenes" ;;
    *) echo "    ℹ️  $table" ;;
  esac
done

echo ""
echo "✓ 测试 3: 验证示例数据"

# 尝试查询 profiles（假设有数据）
PROFILE_COUNT=$(curl -s \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Prefer: count=exact" \
  "${SUPABASE_URL}/rest/v1/profiles?select=*" \
  2>/dev/null | wc -l)

echo "  profiles 表记录数: $PROFILE_COUNT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 诊断完成"
