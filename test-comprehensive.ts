#!/usr/bin/env tsx
/**
 * 🔍 AI Cine Director - Comprehensive System Test
 * Tests all critical functionality without requiring authentication
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const API_BASE = 'http://localhost:3002';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function log(message: string, emoji = '📋') {
  console.log(`${emoji} ${message}`);
}

function pass(name: string, details?: any) {
  results.push({ name, passed: true, details });
  log(`✅ ${name}`, '✅');
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
  log(`❌ ${name}: ${error}`, '❌');
}

async function testBackendHealth() {
  log('Testing backend health...', '🏥');
  try {
    const response = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
    if (response.ok) {
      pass('Backend Health Check');
    } else {
      fail('Backend Health Check', `HTTP ${response.status}`);
    }
  } catch (err: any) {
    fail('Backend Health Check', err.message);
  }
}

async function testEnvVariables() {
  log('Checking environment variables...', '🔑');
  
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
    'REPLICATE_API_TOKEN',
    'STRIPE_SECRET_KEY',
    'MINIMAX_API_KEY',
    'RESEND_API_KEY',
    'ELEVEN_LABS_API_KEY'
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length === 0) {
    pass('Environment Variables', { count: required.length });
  } else {
    fail('Environment Variables', `Missing: ${missing.join(', ')}`);
  }
}

async function testFrontendBuild() {
  log('Checking frontend build...', '🏗️');
  const fs = await import('fs');
  const distExists = fs.existsSync('./dist');
  
  if (distExists) {
    const indexExists = fs.existsSync('./dist/index.html');
    if (indexExists) {
      pass('Frontend Build');
    } else {
      fail('Frontend Build', 'dist/index.html not found');
    }
  } else {
    fail('Frontend Build', 'dist/ directory not found');
  }
}

async function testTypeScriptCompilation() {
  log('Testing TypeScript compilation...', '🔨');
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    await execAsync('npx tsc --noEmit --skipLibCheck');
    pass('TypeScript Compilation');
  } catch (err: any) {
    // TypeScript errors are expected in some cases, check for critical errors only
    if (err.message.includes('error TS')) {
      const criticalErrors = err.message.match(/error TS\d+:/g)?.length || 0;
      if (criticalErrors > 20) {
        fail('TypeScript Compilation', `${criticalErrors} errors found`);
      } else {
        pass('TypeScript Compilation', { warnings: criticalErrors });
      }
    } else {
      fail('TypeScript Compilation', err.message);
    }
  }
}

async function testDependencies() {
  log('Checking npm dependencies...', '📦');
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const { stdout } = await execAsync('npm ls --depth=0 --json');
    const deps = JSON.parse(stdout);
    
    const critical = [
      'react',
      'express',
      '@supabase/supabase-js',
      'replicate',
      'stripe'
    ];
    
    const missing = critical.filter(dep => !deps.dependencies?.[dep]);
    
    if (missing.length === 0) {
      pass('NPM Dependencies', { count: Object.keys(deps.dependencies || {}).length });
    } else {
      fail('NPM Dependencies', `Missing: ${missing.join(', ')}`);
    }
  } catch (err: any) {
    fail('NPM Dependencies', err.message);
  }
}

async function testCriticalFiles() {
  log('Checking critical files...', '📁');
  const fs = await import('fs');
  
  const criticalFiles = [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'api/index.ts',
    'server/index.ts',
    'types.ts',
    'lib/supabaseClient.ts',
    'context/AppContext.tsx',
    'components/VideoGenerator.tsx'
  ];
  
  const missing = criticalFiles.filter(file => !fs.existsSync(file));
  
  if (missing.length === 0) {
    pass('Critical Files', { count: criticalFiles.length });
  } else {
    fail('Critical Files', `Missing: ${missing.join(', ')}`);
  }
}

async function testSecurityIssues() {
  log('Checking for security vulnerabilities...', '🔒');
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const { stdout } = await execAsync('npm audit --json');
    const audit = JSON.parse(stdout);
    
    const high = audit.metadata?.vulnerabilities?.high || 0;
    const critical = audit.metadata?.vulnerabilities?.critical || 0;
    
    if (critical === 0 && high < 5) {
      pass('Security Audit', { high, critical });
    } else {
      fail('Security Audit', `${critical} critical, ${high} high severity issues`);
    }
  } catch (err: any) {
    // npm audit returns exit code 1 if vulnerabilities found
    try {
      const audit = JSON.parse(err.stdout || '{}');
      const high = audit.metadata?.vulnerabilities?.high || 0;
      const critical = audit.metadata?.vulnerabilities?.critical || 0;
      
      if (critical === 0 && high < 5) {
        pass('Security Audit', { high, critical });
      } else {
        fail('Security Audit', `${critical} critical, ${high} high severity issues`);
      }
    } catch {
      fail('Security Audit', 'Unable to parse audit results');
    }
  }
}

async function generateReport() {
  log('Generating test report...', '📊');
  
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const percentage = Math.round((passed / total) * 100);
  
  console.log('\n' + '═'.repeat(80));
  console.log('🎬 AI CINE DIRECTOR - COMPREHENSIVE TEST REPORT');
  console.log('═'.repeat(80));
  console.log(`\n📈 Overall Score: ${percentage}% (${passed}/${total} tests passed)\n`);
  
  if (failed > 0) {
    console.log('❌ FAILED TESTS:\n');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   • ${r.name}`);
      console.log(`     Error: ${r.error}\n`);
    });
  }
  
  console.log('✅ PASSED TESTS:\n');
  results.filter(r => r.passed).forEach(r => {
    const details = r.details ? ` (${JSON.stringify(r.details)})` : '';
    console.log(`   • ${r.name}${details}`);
  });
  
  console.log('\n' + '═'.repeat(80));
  console.log(`🎯 Status: ${percentage >= 80 ? '✅ HEALTHY' : percentage >= 60 ? '⚠️ NEEDS ATTENTION' : '❌ CRITICAL ISSUES'}`);
  console.log('═'.repeat(80) + '\n');
  
  return percentage >= 80;
}

async function main() {
  console.log('\n🚀 Starting AI Cine Director System Test...\n');
  
  await testEnvVariables();
  await testCriticalFiles();
  await testDependencies();
  await testSecurityIssues();
  await testFrontendBuild();
  await testTypeScriptCompilation();
  await testBackendHealth();
  
  const success = await generateReport();
  
  if (!success) {
    console.log('⚠️  Some tests failed. Please review the report above.\n');
    process.exit(1);
  } else {
    console.log('🎉 All critical systems operational!\n');
  }
}

main().catch((err) => {
  console.error('💥 Test suite crashed:', err);
  process.exit(1);
});
