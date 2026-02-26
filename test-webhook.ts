import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-01-28.clover' });

async function run() {
    const payload = JSON.stringify({
        id: 'evt_test_webhook',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_test_mock',
                mode: 'payment',
                metadata: {
                    user_id: '15d31295-a270-43eb-b673-86f32e4d0fc5', // dev UUID
                    credits: '500'
                }
            }
        }
    });

    // To test the exact webhook, we'd need to compute the signature
    const secret = process.env.STRIPE_WEBHOOK_SECRET!;
    const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret
    });

    console.log("Testing webhook with signature:", signature);
    const response = await fetch('http://localhost:3002/api/billing/webhook', {
        method: 'POST',
        headers: {
            'stripe-signature': signature,
            'Content-Type': 'application/json'
        },
        body: payload
    });

    console.log('Webhook Status:', response.status);
    console.log('Webhook Response:', await response.text());
}
run();
