// 快速测试脚本：验证开发者邮箱识别功能
// 在浏览器 DevTools Console 运行此代码

const DEVELOPER_EMAILS = new Set([
  'forevercrab321@gmail.com'
]);

const isDeveloperEmail = (email) => {
  return DEVELOPER_EMAILS.has(email?.toLowerCase());
};

// 测试用例
const testEmails = [
  { email: 'forevercrab321@gmail.com', expected: true },
  { email: 'FOREVERCRAB321@GMAIL.COM', expected: true }, // 大小写不敏感
  { email: 'user@example.com', expected: false },
  { email: 'test@unknown.com', expected: false },
];

console.log('🔍 开发者邮箱识别测试\n');
console.log('='.repeat(50));

let passed = 0;
let failed = 0;

testEmails.forEach(({ email, expected }) => {
  const result = isDeveloperEmail(email);
  const status = result === expected ? '✅ PASS' : '❌ FAIL';
  
  if (result === expected) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`${status} | ${email.padEnd(30)} | isDeveloper=${result}`);
});

console.log('='.repeat(50));
console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败`);
console.log(`成功率: ${((passed / testEmails.length) * 100).toFixed(0)}%\n`);

// 打印开发者列表
console.log('📋 当前注册的开发者邮箱:');
Array.from(DEVELOPER_EMAILS).forEach((email, i) => {
  console.log(`  ${i + 1}. ${email}`);
});

console.log('\n💡 提示: 在登入页使用上述任何邮箱测试自动 admin 模式激活');
