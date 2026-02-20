import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { geminiRouter } from '../server/routes/gemini';
import { replicateRouter } from '../server/routes/replicate';

// Polyfill fetch for Node 16/17 on Vercel
if (!globalThis.fetch) {
    // @ts-ignore
    globalThis.fetch = fetch;
    // @ts-ignore
    globalThis.Headers = (fetch as any).Headers;
    // @ts-ignore
    globalThis.Request = (fetch as any).Request;
    // @ts-ignore
    globalThis.Response = (fetch as any).Response;
}

// --- Setup ---
dotenv.config({ path: '.env.local' });
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// --- Helpers ---
const getSupabaseAdmin = () => {
    const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    return createClient(url, key);
};

const getStripe = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY missing');
    return new Stripe(key, { apiVersion: '2026-01-28.clover' });
};

// --- Auth ---
const requireAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
};

// --- Routes (delegated to shared route modules) ---
app.use('/api/gemini', geminiRouter);
app.use('/api/replicate', replicateRouter);

// --- Billing: Checkout ---
app.post('/api/billing/checkout', requireAuth, async (req: any, res: any) => {
    const { packageId } = req.body;
    const userId = req.user.id;
    const stripe = getStripe();

    const PACKAGES: Record<string, { price: number, credits: number, name: string }> = {
        'pack_small': { price: 500, credits: 500, name: 'Starter Pack (500 Credits)' },
        'pack_medium': { price: 1000, credits: 1200, name: 'Value Pack (1200 Credits)' },
        'pack_large': { price: 2500, credits: 3500, name: 'Pro Pack (3500 Credits)' },
    };

    const pkg = PACKAGES[packageId];
    if (!pkg) return res.status(400).json({ error: 'Invalid package' });

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
                currency: 'usd',
                product_data: { name: pkg.name },
                unit_amount: pkg.price,
            },
            quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.headers.origin}/?success=true`,
        cancel_url: `${req.headers.origin}/?canceled=true`,
        metadata: {
            user_id: userId,
            credits: pkg.credits.toString()
        }
    });

    res.json({ url: session.url });
});

// --- Billing: Webhook → add credits via ledger ---
app.post('/api/billing/webhook', async (req: any, res: any) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = getStripe();

    let event;
    try {
        if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET missing');
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
        console.error('[Webhook Error]', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const credits = Number(session.metadata?.credits);

        if (userId && credits) {
            const supabase = getSupabaseAdmin();
            await supabase.from('credits_ledger').insert({
                user_id: userId,
                delta: credits,
                kind: 'purchase',
                ref_type: 'stripe',
                ref_id: String(session.id),
                status: 'settled'
            });
            // Also add to profile balance directly for immediate availability
            const { data: profile } = await supabase
                .from('profiles')
                .select('credits')
                .eq('id', userId)
                .single();
            if (profile) {
                await supabase
                    .from('profiles')
                    .update({ credits: (profile.credits || 0) + credits })
                    .eq('id', userId);
            }
            console.log(`[Billing] Added ${credits} credits to user ${userId}`);
        }
    }

    res.json({ received: true });
});

// --- Health ---
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), build: 'ledger-v1' });
});

export default app;