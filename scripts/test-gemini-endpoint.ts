#!/usr/bin/env tsx
/**
 * 临时测试脚本 - 模拟前端调用
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testGeminiGenerate() {
  console.log('\n🧪 测试 Gemini 生成端点...\n');
  
  try {
    // 模拟真实的请求
    const response = await fetch('http://localhost:3002/api/gemini/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 不带 Authorization 模拟未登录（会被拒绝）
      },
      body: JSON.stringify({
        storyIdea: '哪吒大战孙悟空',
        visualStyle: 'realistic',
        language: 'zh',
        mode: 'storyboard',
      }),
    });
    
    const text = await response.text();
    console.log('响应状态:', response.status);
    console.log('响应内容:', text);
    
    if (!response.ok) {
      console.error('❌ 请求失败');
      return false;
    }
    
    console.log('✅ 请求成功');
    return true;
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    return false;
  }
}

testGeminiGenerate().then(() => process.exit(0));
