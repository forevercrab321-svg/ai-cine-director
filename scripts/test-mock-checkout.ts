import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  // Login as dev to get an access token
  const { data, error } = await supabaseAdmin.auth.signInWithOtp({
    email: 'forevercrab321@gmail.com'
  });
  
  // Actually we can't reliably get an access token from signInWithOtp programmatically without the OTP.
  // Instead, let's just create a new dummy user or use a magic auth hook with supabase-js...
  
  // Alternative: create a test user and sign in with password
  const testEmail = 'testpayer1@example.com';
  const testPassword = 'Password123!';
  
  await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });

  const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInError) {
      console.error(signInError);
      return;
  }
  
  const token = signInData.session?.access_token;

  console.log("Got access token, testing checkout...");
  const response = await fetch('http://localhost:3002/api/billing/checkout', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ packageId: 'pack_small' })
  });

  const body = await response.text();
  console.log('Status:', response.status);
  console.log('Body:', body);
  
  // Test subscribe
  console.log("Testing subscribe...");
  const subResponse = await fetch('http://localhost:3002/api/billing/subscribe', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ tier: 'creator', billingCycle: 'monthly' })
  });

  console.log('Subscribe Status:', subResponse.status);
  console.log('Subscribe Body:', await subResponse.text());
}

run();
