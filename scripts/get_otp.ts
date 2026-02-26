import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'forevercrab321@gmail.com',
  });
  if (error) {
    console.error(error);
  } else {
    console.log("OTP Properties:", JSON.stringify(data.properties, null, 2));
    console.log("Action Link:", data.properties?.action_link);
  }
}
run();
