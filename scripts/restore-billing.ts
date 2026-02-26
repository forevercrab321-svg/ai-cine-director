import fs from 'fs';
import path from 'path';

const stub = `
// ───────────────────────────────────────────────────────────────
// POST /api/billing/checkout — Create Stripe Checkout Session for Credits
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/checkout', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { packageId } = req.body;
        const stripe = getStripe();

        // CREDIT_PACKS hardcoded here for simplicity or derived from types
        const CREDIT_PACKS = [
            { id: 'pack_small', price: 5, credits: 500, label: 'Starter Pack' },
            { id: 'pack_medium', price: 10, credits: 1200, label: 'Value Pack', popular: true },
            { id: 'pack_large', price: 25, credits: 3500, label: 'Pro Pack' }
        ];
        
        const pack = CREDIT_PACKS.find(p => p.id === packageId);
        if (!pack) return res.status(400).json({ error: 'Invalid package' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: \`AI Cine-Director: \${pack.label}\`,
                            description: \`\${pack.credits} Credits for AI video generation\`,
                        },
                        unit_amount: pack.price * 100, // cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: \`\${process.env.VITE_APP_URL || 'http://localhost:3000'}/?payment=success\`,
            cancel_url: \`\${process.env.VITE_APP_URL || 'http://localhost:3000'}/?payment=cancelled\`,
            client_reference_id: userId, // extremely important for webhook
            metadata: {
                user_id: userId,
                credits: pack.credits.toString()
            }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[Billing Checkout Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/billing/subscribe — Create Stripe Checkout Session for Subscriptions
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/subscribe', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { tier, billingCycle } = req.body;
        const stripe = getStripe();

        const STRIPE_PRICES: any = {
            monthly: { creator: 'price_mock_creator_monthly', director: 'price_mock_director_monthly' },
            yearly: { creator: 'price_mock_creator_yearly', director: 'price_mock_director_yearly' }
        };

        const priceId = STRIPE_PRICES[billingCycle]?.[tier];
        if (!priceId) return res.status(400).json({ error: 'Invalid subscription tier/cycle' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: \`\${process.env.VITE_APP_URL || 'http://localhost:3000'}/?subscription=success\`,
            cancel_url: \`\${process.env.VITE_APP_URL || 'http://localhost:3000'}/?subscription=cancelled\`,
            client_reference_id: userId,
            metadata: {
                user_id: userId,
                tier: tier
            }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[Billing Subscribe Error]', err);
        res.status(500).json({ error: err.message });
    }
});
`;

const indexPath = path.join(process.cwd(), 'api', 'index.ts');
let indexContent = fs.readFileSync(indexPath, 'utf8');

if (!indexContent.includes('app.post(\'/api/billing/checkout\'') && !indexContent.includes('app.post(\"/api/billing/checkout\"')) {
    indexContent = indexContent.replace('// Billing checkout', stub);
    fs.writeFileSync(indexPath, indexContent);
    console.log('Restored billing endpoints successfully.');
} else {
    console.log('Billing endpoints already exist, skipping restore.');
}
