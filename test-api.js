const fetch = require('node-fetch');
async function test() {
  const res = await fetch('https://ai-cine-director-2jx4.vercel.app/api/replicate/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: "black-forest-labs/flux-schnell", input: { prompt: "test" } })
  });
  const text = await res.text();
  console.log(res.status, text);
}
test();
