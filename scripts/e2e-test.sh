#!/bin/bash
# 完整端到端测试脚本
# 测试所有核心API端点

set -e

API_BASE="${API_BASE:-http://localhost:3002}"
PROD_BASE="https://aidirector.business"

echo "========================================"
echo "🎬 AI Cine Director - 完整系统测试"
echo "========================================"
echo ""

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; }
fail() { echo -e "${RED}❌ FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠️  WARN${NC}: $1"; }
info() { echo -e "📋 $1"; }

# 测试计数
PASSED=0
FAILED=0

test_api() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected="$5"
    
    info "测试: $name"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -sS "${API_BASE}${endpoint}" 2>/dev/null || echo "CURL_ERROR")
    else
        response=$(curl -sS -X "$method" "${API_BASE}${endpoint}" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null || echo "CURL_ERROR")
    fi
    
    if echo "$response" | grep -q "$expected"; then
        pass "$name"
        ((PASSED++))
        return 0
    else
        warn "$name - 响应: $(echo "$response" | head -c 200)"
        ((FAILED++))
        return 1
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  本地 API 健康检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_api "健康检查" "GET" "/api/health" "" "ok"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  生产 API 健康检查"  
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
prod_health=$(curl -sS "$PROD_BASE/api/health" 2>/dev/null || echo "CURL_ERROR")
if echo "$prod_health" | grep -q "ok"; then
    pass "生产环境健康检查"
    ((PASSED++))
else
    warn "生产环境可能未更新: $prod_health"
    ((FAILED++))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  OTP 邮件发送 (需要有效邮箱)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_api "OTP发送" "POST" "/api/auth/send-otp" '{"email":"test@example.com"}' "ok"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  Gemini 剧本生成 (需要认证)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
# 无认证应返回401
gemini_unauth=$(curl -sS -X POST "${API_BASE}/api/gemini/generate" \
    -H "Content-Type: application/json" \
    -d '{"storyIdea":"测试","visualStyle":"realism","language":"zh"}' 2>/dev/null || echo "CURL_ERROR")

if echo "$gemini_unauth" | grep -qE "401|Unauthorized|Missing"; then
    pass "Gemini未认证返回401"
    ((PASSED++))
else
    warn "Gemini未认证检查 - 响应: $(echo "$gemini_unauth" | head -c 100)"
    ((FAILED++))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  Replicate 预测 (需要认证)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
replicate_unauth=$(curl -sS -X POST "${API_BASE}/api/replicate/predict" \
    -H "Content-Type: application/json" \
    -d '{"version":"test","input":{}}' 2>/dev/null || echo "CURL_ERROR")

if echo "$replicate_unauth" | grep -qE "401|Unauthorized|Missing"; then
    pass "Replicate未认证返回401"
    ((PASSED++))
else
    warn "Replicate未认证检查 - 响应: $(echo "$replicate_unauth" | head -c 100)"
    ((FAILED++))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6️⃣  批量生成端点存在性检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
batch_check=$(curl -sS -X POST "${API_BASE}/api/batch/gen-images" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null || echo "CURL_ERROR")

# 应返回401(未认证)或400(缺参数)，不应该是404
if echo "$batch_check" | grep -qE "401|400|Missing|Unauthorized"; then
    pass "批量生成端点存在"
    ((PASSED++))
elif echo "$batch_check" | grep -q "404"; then
    fail "批量生成端点404 - 路由未注册"
else
    warn "批量生成端点检查 - 响应: $(echo "$batch_check" | head -c 100)"
    ((FAILED++))
fi

echo ""
echo "========================================"
echo "📊 测试结果汇总"
echo "========================================"
echo -e "  ${GREEN}通过: $PASSED${NC}"
echo -e "  ${RED}失败: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  有 $FAILED 个测试需要关注${NC}"
    exit 1
fi
