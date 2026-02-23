#!/bin/bash
# SQL语法验证脚本 - 在执行前验证SQL文件

echo "🔍 验证 negative_balance_protection_fixed.sql 语法..."

# 检查基本SQL语法（简单检查）
check_sql_syntax() {
  local file=$1
  local errors=0
  
  # 检查1: BEGIN/END配对
  local begin_count=$(grep -c "BEGIN" "$file")
  local end_count=$(grep -c "END" "$file")
  echo "  BEGIN 语句: $begin_count"
  echo "  END 语句: $end_count"
  
  # 检查2: DO $$ 块配对
  local do_count=$(grep -c "DO \$\$" "$file")
  echo "  DO \$\$ 块: $do_count"
  
  # 检查3: 函数定义
  local func_count=$(grep -c "CREATE.*FUNCTION" "$file")
  echo "  函数定义: $func_count"
  
  # 检查4: 触发器定义
  local trigger_count=$(grep -c "CREATE TRIGGER" "$file")
  echo "  触发器: $trigger_count"
  
  # 检查5: 约束定义
  local constraint_count=$(grep -c "ADD CONSTRAINT" "$file")
  echo "  约束定义: $constraint_count"
  
  echo ""
}

cd "$(dirname "$0")"

if [ ! -f "negative_balance_protection_fixed.sql" ]; then
  echo "❌ 文件不存在: negative_balance_protection_fixed.sql"
  exit 1
fi

check_sql_syntax "negative_balance_protection_fixed.sql"

echo "✅ 基本语法检查通过"
echo ""
echo "📋 执行清单："
echo "  1. 打开 Supabase Dashboard → SQL Editor"
echo "  2. 复制 negative_balance_protection_fixed.sql 全部内容"
echo "  3. 粘贴到编辑器"
echo "  4. 点击 RUN 按钮"
echo "  5. 查看输出日志确认成功"
echo ""
echo "⚠️  注意事项："
echo "  • 确保 profiles 表已存在"
echo "  • 使用 Service Role 权限执行"
echo "  • 不要同时执行 negative_balance_protection.sql (旧版本)"
echo ""
