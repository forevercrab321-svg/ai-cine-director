import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testMinimax() {
    const MINIMAX_TEXT_API = 'https://api.minimax.io/v1/text/chatcompletion_v2';
    const apiKey = process.env.VITE_MINIMAX_API_KEY || process.env.MINIMAX_API_KEY;
    console.log("Key exists:", !!apiKey);

    const payload = {
        model: 'MiniMax-Text-01',
        messages: [
            { role: "system", name: "System", content: "You are a helpful assistant." },
            { role: "user", name: "User", content: "Write a short 3 sentence story about a brave knight." }
        ],
        temperature: 0.7,
    };

    try {
        const response = await fetch(MINIMAX_TEXT_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("Status:", response.status);
        if (data.choices && data.choices[0]) {
            console.log("Response text:\n", data.choices[0].message.content);
        } else {
            console.log("Full Response:", JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.error("Error:", err);
    }
}

testMinimax();
