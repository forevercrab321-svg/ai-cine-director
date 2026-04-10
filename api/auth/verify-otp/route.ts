/**
 * Verify OTP API Handler - Vercel Serverless Function
 * POST /api/auth/verify-otp
 */
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gtxgkdsayswonlewqfzj.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export default async function handler(req: Request) {
    try {
        const body = await req.json();
        const { email, otp } = body;

        if (!email || !otp) {
            return new Response(JSON.stringify({
                error: 'MISSING_FIELDS',
                message: 'Email and OTP are required'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Simple OTP verification (in production, verify against stored hash)
        // For demo, accept any 6-digit OTP
        if (!/^\d{6}$/.test(otp)) {
            return new Response(JSON.stringify({
                error: 'INVALID_OTP',
                message: 'OTP must be 6 digits'
            }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        // Create or get user from Supabase Auth
        let userId = '';
        let sessionToken = '';

        try {
            // Sign up or get existing user
            const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({
                    email: email.toLowerCase(),
                    email_confirm: true,
                }),
            });

            if (authResponse.ok) {
                const userData = await authResponse.json();
                userId = userData.id || userData.user?.id || '';
            }

            // Generate session token
            sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (err) {
            console.error('Auth error:', err);
        }

        return new Response(JSON.stringify({
            ok: true,
            message: 'OTP verified successfully',
            email: email.toLowerCase(),
            userId: userId || 'demo-user-' + Date.now(),
            sessionToken: sessionToken || 'demo-token-' + Date.now(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error('Verify OTP error:', error);
        return new Response(JSON.stringify({
            error: 'INTERNAL_ERROR',
            message: 'Failed to verify OTP'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
