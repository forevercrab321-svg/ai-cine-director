#!/usr/bin/env tsx
/**
 * 测试邮件发送功能
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

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

async function testEmailSending() {
  const testEmail = process.argv[2] || 'forevercrab321@gmail.com';
  
  log('\n📧 测试邮件发送功能', colors.blue);
  log('='.repeat(60), colors.blue);
  log(`收件人: ${testEmail}`, colors.reset);
  
  try {
    // 调用后端 API 发送 OTP
    const response = await fetch('http://localhost:3002/api/auth/send-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testEmail,
        redirectTo: 'http://localhost:3000',
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      log('\n✅ 邮件发送成功！', colors.green);
      log(`响应: ${JSON.stringify(data, null, 2)}`, colors.reset);
      log('\n请检查邮箱 (包括垃圾邮件文件夹)', colors.yellow);
    } else {
      const errorData = await response.json().catch(() => ({}));
      log('\n❌ 邮件发送失败', colors.red);
      log(`HTTP ${response.status}`, colors.red);
      log(`错误: ${JSON.stringify(errorData, null, 2)}`, colors.red);
    }
  } catch (error: any) {
    log('\n❌ 请求失败', colors.red);
    log(`错误: ${error.message}`, colors.red);
    log('\n提示: 请确保后端服务器正在运行 (npm run dev:all)', colors.yellow);
  }
}

async function testResendAPI() {
  const apiKey = process.env.RESEND_API_KEY;
  
  log('\n📨 测试 Resend API 直接调用', colors.blue);
  log('='.repeat(60), colors.blue);
  
  if (!apiKey) {
    log('❌ RESEND_API_KEY 未配置', colors.red);
    return;
  }
  
  const testEmail = process.argv[2] || 'forevercrab321@gmail.com';
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AI Cine Director <noreply@aidirector.business>',
        to: testEmail,
        subject: 'Test Email - AI Cine Director',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #4f46e5;">🎬 AI Cine Director</h1>
            <p>这是一封测试邮件。</p>
            <p>如果您收到此邮件，说明邮件系统配置正确。</p>
            <p style="color: #666; font-size: 12px; margin-top: 24px;">
              发送时间: ${new Date().toLocaleString('zh-CN')}
            </p>
          </div>
        `,
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      log('\n✅ Resend API 调用成功！', colors.green);
      log(`Email ID: ${data.id}`, colors.reset);
      log('\n请检查邮箱 (包括垃圾邮件文件夹)', colors.yellow);
    } else {
      const errorText = await response.text();
      log('\n❌ Resend API 调用失败', colors.red);
      log(`HTTP ${response.status}`, colors.red);
      log(`错误: ${errorText}`, colors.red);
    }
  } catch (error: any) {
    log('\n❌ Resend API 请求失败', colors.red);
    log(`错误: ${error.message}`, colors.red);
  }
}

async function main() {
  log('\n🎬 AI Cine Director - 邮件系统测试', colors.blue);
  log('='.repeat(60), colors.blue);
  
  // 1. 测试 Resend API 直接调用
  await testResendAPI();
  
  // 2. 测试完整的 OTP 发送流程
  await testEmailSending();
  
  log('\n' + '='.repeat(60), colors.blue);
  log('测试完成', colors.blue);
  log('='.repeat(60), colors.blue);
}

main().catch(console.error);
