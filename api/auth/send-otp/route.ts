/**
 * Send OTP API Handler - Vercel Serverless Function
 * POST /api/auth/send-otp
 */
export const config = { runtime: 'edge' };

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 10;

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req: Request) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (record && now < record.resetAt && record.count >= RATE_LIMIT_MAX) {
        return new Response(JSON.stringify({
            error: 'TOO_MANY_REQUESTS',
            message: 'Please wait before requesting another OTP'
        }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    if (!record || now > record.resetAt) {
        rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    } else {
        record.count++;
    }

    try {
        const body = await req.json();
        const email = body.email?.trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return new Response(JSON.stringify({
                error: 'INVALID_EMAIL',
                message: 'Please provide a valid email address'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const otp = generateOTP();
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'onboarding@resend.dev',
                to: [email],
                subject: 'Your AI Cine Director OTP Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #333;">AI Cine Director</h2>
                        <p>Your OTP code is: <strong style="font-size: 24px; color: #0066cc;">${otp}</strong></p>
                        <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                    </div>
                `,
                text: `Your OTP code is: ${otp}. This code expires in 10 minutes.`,
            }),
        });

        if (!response.ok) {
            console.error('Resend error:', await response.text());
            return new Response(JSON.stringify({
                error: 'EMAIL_SEND_FAILED',
                message: 'Failed to send OTP email'
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
            ok: true,
            message: 'OTP sent successfully',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Send OTP error:', error);
        return new Response(JSON.stringify({
            error: 'INTERNAL_ERROR',
            message: 'Failed to process request'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
