const { createClient } = require('@supabase/supabase-js');
const url = "https://gtxgkdsayswonlewqfzj.supabase.co\\n";
const cleanUrl = url.replace(/\\n/g, '').replace(/\n/g, '').trim();
console.log("Cleaned URL:", cleanUrl);
try {
  const client = createClient(cleanUrl, "dummy-key");
  console.log("Client created successfully");
} catch (e) {
  console.log("Error creating client:", e.message);
}
