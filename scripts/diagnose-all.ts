#!/usr/bin/env tsx
/**
 * 全面诊断脚本 - 检查前后端所有组件
 */
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

// 测试颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(msg: string, color: string = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function addResult(result: TestResult) {
  results.push(result);
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
  const color = result.status === 'PASS' ? colors.green : result.status === 'FAIL' ? colors.red : colors.yellow;
  log(`${icon} ${result.name}: ${result.message}`, color);
  if (result.details) {
    console.log('   Details:', result.details);
  }
}

// 1. 检查环境变量
async function checkEnvironmentVariables() {
  log('\n📋 检查环境变量配置...', colors.blue);
  
  const requiredVars = [
    { name: 'VITE_SUPABASE_URL', category: 'Supabase' },
    { name: 'VITE_SUPABASE_ANON_KEY', category: 'Supabase' },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', category: 'Supabase' },
    { name: 'GEMINI_API_KEY', category: 'Gemini' },
    { name: 'REPLICATE_API_TOKEN', category: 'Replicate' },
    { name: 'RESEND_API_KEY', category: 'Resend' },
    { name: 'STRIPE_SECRET_KEY', category: 'Stripe' },
  ];

  for (const { name, category } of requiredVars) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      addResult({
        name: `ENV: ${name}`,
        status: 'PASS',
        message: `${category} 配置已设置 (${value.substring(0, 10)}...)`,
      });
    } else {
      addResult({
        name: `ENV: ${name}`,
        status: 'FAIL',
        message: `${category} 配置缺失`,
      });
    }
  }
}

// 2. 检查后端服务器
async function checkBackendServer() {
  log('\n🔌 检查后端服务器...', colors.blue);
  
  try {
    const response = await fetch('http://localhost:3002/api/health');
    if (response.ok) {
      const data = await response.json();
      addResult({
        name: 'Backend Server',
        status: 'PASS',
        message: '后端服务器运行正常',
        details: data,
      });
      
      // 检查各个API Key状态
      if (data.geminiKey?.includes('✅')) {
        addResult({
          name: 'Gemini API',
          status: 'PASS',
          message: 'Gemini API Key 配置正确',
        });
      } else {
        addResult({
          name: 'Gemini API',
          status: 'FAIL',
          message: 'Gemini API Key 未配置',
        });
      }
      
      if (data.replicateToken?.includes('✅')) {
        addResult({
          name: 'Replicate API',
          status: 'PASS',
          message: 'Replicate API Token 配置正确',
        });
      } else {
        addResult({
          name: 'Replicate API',
          status: 'FAIL',
          message: 'Replicate API Token 未配置',
        });
      }
    } else {
      addResult({
        name: 'Backend Server',
        status: 'FAIL',
        message: `后端服务器响应错误: HTTP ${response.status}`,
      });
    }
  } catch (error: any) {
    addResult({
      name: 'Backend Server',
      status: 'FAIL',
      message: '后端服务器未运行',
      details: error.message,
    });
  }
}

// 3. 检查 Supabase 连接
async function checkSupabaseConnection() {
  log('\n🗄️  检查 Supabase 连接...', colors.blue);
  
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || '',
      process.env.VITE_SUPABASE_ANON_KEY || ''
    );
    
    // 尝试查询
    const { error } = await supabase.from('profiles').select('count').limit(1);
    
    if (error) {
      addResult({
        name: 'Supabase Connection',
        status: 'FAIL',
        message: 'Supabase 连接失败',
        details: error.message,
      });
    } else {
      addResult({
        name: 'Supabase Connection',
        status: 'PASS',
        message: 'Supabase 数据库连接正常',
      });
    }
  } catch (error: any) {
    addResult({
      name: 'Supabase Connection',
      status: 'FAIL',
      message: 'Supabase 客户端初始化失败',
      details: error.message,
    });
  }
}

// 4. 检查 Gemini API
async function checkGeminiAPI() {
  log('\n🤖 检查 Gemini API...', colors.blue);
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    addResult({
      name: 'Gemini API Test',
      status: 'FAIL',
      message: 'GEMINI_API_KEY 未配置',
    });
    return;
  }
  
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Say "Hello" in one word.',
    });
    
    const text = response.text;
    addResult({
      name: 'Gemini API Test',
      status: 'PASS',
      message: 'Gemini API 调用成功',
      details: `Response: ${text}`,
    });
  } catch (error: any) {
    addResult({
      name: 'Gemini API Test',
      status: 'FAIL',
      message: 'Gemini API 调用失败',
      details: error.message,
    });
  }
}

// 5. 检查 Replicate API
async function checkReplicateAPI() {
  log('\n🎨 检查 Replicate API...', colors.blue);
  
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    addResult({
      name: 'Replicate API Test',
      status: 'FAIL',
      message: 'REPLICATE_API_TOKEN 未配置',
    });
    return;
  }
  
  try {
    // 测试 Replicate API - 仅获取账户信息，不创建预测
    const response = await fetch('https://api.replicate.com/v1/account', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      addResult({
        name: 'Replicate API Test',
        status: 'PASS',
        message: 'Replicate API 认证成功',
        details: `Account: ${data.username || 'Unknown'}`,
      });
    } else {
      addResult({
        name: 'Replicate API Test',
        status: 'FAIL',
        message: `Replicate API 认证失败: HTTP ${response.status}`,
      });
    }
  } catch (error: any) {
    addResult({
      name: 'Replicate API Test',
      status: 'FAIL',
      message: 'Replicate API 调用失败',
      details: error.message,
    });
  }
}

// 6. 检查 Resend API
async function checkResendAPI() {
  log('\n📧 检查 Resend API...', colors.blue);
  
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    addResult({
      name: 'Resend API Test',
      status: 'FAIL',
      message: 'RESEND_API_KEY 未配置',
    });
    return;
  }
  
  try {
    // 测试 Resend API - 获取域名列表
    const response = await fetch('https://api.resend.com/domains', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const domains = data.data || [];
      
      if (domains.length === 0) {
        addResult({
          name: 'Resend API Test',
          status: 'WARN',
          message: 'Resend API 认证成功，但没有配置域名',
          details: '建议: 添加自定义域名或使用 onboarding@resend.dev 测试',
        });
      } else {
        const pendingDomains = domains.filter((d: any) => d.status === 'pending');
        const verifiedDomains = domains.filter((d: any) => d.status === 'verified');
        
        if (verifiedDomains.length > 0) {
          addResult({
            name: 'Resend API Test',
            status: 'PASS',
            message: `Resend API 正常，已验证域名: ${verifiedDomains.length}个`,
            details: verifiedDomains.map((d: any) => d.name),
          });
        } else if (pendingDomains.length > 0) {
          addResult({
            name: 'Resend API Test',
            status: 'WARN',
            message: `Resend API 正常，但域名待验证: ${pendingDomains.length}个`,
            details: pendingDomains.map((d: any) => ({ name: d.name, status: d.status })),
          });
        } else {
          addResult({
            name: 'Resend API Test',
            status: 'WARN',
            message: 'Resend API 正常，但域名状态未知',
          });
        }
      }
    } else {
      const errorText = await response.text();
      addResult({
        name: 'Resend API Test',
        status: 'FAIL',
        message: `Resend API 认证失败: HTTP ${response.status}`,
        details: errorText,
      });
    }
  } catch (error: any) {
    addResult({
      name: 'Resend API Test',
      status: 'FAIL',
      message: 'Resend API 调用失败',
      details: error.message,
    });
  }
}

// 7. 检查前端服务器
async function checkFrontendServer() {
  log('\n🌐 检查前端服务器...', colors.blue);
  
  try {
    const response = await fetch('http://localhost:3000');
    if (response.ok) {
      addResult({
        name: 'Frontend Server',
        status: 'PASS',
        message: '前端服务器运行正常',
      });
    } else {
      addResult({
        name: 'Frontend Server',
        status: 'FAIL',
        message: `前端服务器响应错误: HTTP ${response.status}`,
      });
    }
  } catch (error: any) {
    addResult({
      name: 'Frontend Server',
      status: 'FAIL',
      message: '前端服务器未运行',
      details: error.message,
    });
  }
}

// 主函数
async function main() {
  log('\n🎬 AI Cine Director - 全面诊断', colors.blue);
  log('='.repeat(60), colors.blue);
  
  await checkEnvironmentVariables();
  await checkBackendServer();
  await checkFrontendServer();
  await checkSupabaseConnection();
  await checkGeminiAPI();
  await checkReplicateAPI();
  await checkResendAPI();
  
  // 汇总结果
  log('\n' + '='.repeat(60), colors.blue);
  log('📊 诊断汇总', colors.blue);
  log('='.repeat(60), colors.blue);
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  
  log(`✅ 通过: ${passed}`, colors.green);
  log(`⚠️  警告: ${warned}`, colors.yellow);
  log(`❌ 失败: ${failed}`, colors.red);
  
  if (failed === 0) {
    log('\n🎉 所有关键组件运行正常！', colors.green);
  } else {
    log('\n⚠️  发现问题，请查看上面的详细信息', colors.yellow);
  }
  
  // 提供建议
  log('\n💡 建议:', colors.blue);
  if (failed > 0) {
    log('1. 检查 .env.local 文件中的 API 密钥是否正确配置', colors.yellow);
    log('2. 确保运行了 npm run dev:all 启动前后端服务', colors.yellow);
    log('3. 如果 Resend 域名待验证，可以先使用 onboarding@resend.dev 测试', colors.yellow);
  }
  
  log('\n📝 提示:', colors.blue);
  log('- 前端: http://localhost:3000', colors.reset);
  log('- 后端: http://localhost:3002', colors.reset);
  log('- 健康检查: http://localhost:3002/api/health', colors.reset);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
