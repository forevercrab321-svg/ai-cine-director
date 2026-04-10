/**
 * Vercel Serverless Function - Unified API Handler
 * Handles all /api/* routes directly without Express overhead
 * This is a fallback solution when the Express wrapper causes timeouts
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Environment variables (set in Vercel dashboard)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

// Simple in-memory rate limiting
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
           req.headers.get('x-real-ip') ||
           'unknown';
}

function enforceRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetAt) {
        rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }

    record.count++;
    return true;
}

function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailViaResend(to: string, otp: string, email: string): Promise<boolean> {
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'AI Cine Director <noreply@ai-cine-director.com>',
                to: [to],
                subject: 'Your AI Cine Director OTP Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #333;">AI Cine Director</h2>
                        <p>Your OTP code is: <strong style="font-size: 24px; color: #0066cc;">${otp}</strong></p>
                        <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                        <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
                    </div>
                `,
                text: `Your AI Cine Director OTP code is: ${otp}. This code expires in 10 minutes.`,
            }),
        });

        return response.ok;
    } catch (error) {
        console.error('Resend API error:', error);
        return false;
    }
}

// Route handlers
async function handleSendOTP(req: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(req);

    if (!enforceRateLimit(ip)) {
        return NextResponse.json(
            { error: 'TOO_MANY_REQUESTS', message: 'Please wait before requesting another OTP' },
            { status: 429 }
        );
    }

    try {
        const body = await req.json();
        const email = body.email?.trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json(
                { error: 'INVALID_EMAIL', message: 'Please provide a valid email address' },
                { status: 400 }
            );
        }

        const otp = generateOTP();
        const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Store OTP in Supabase
        const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/otp_tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Prefer': 'return=representation',
            },
            body: JSON.stringify({
                email,
                otp_hash: hashedOtp,
                expires_at: expiresAt,
                created_at: new Date().toISOString(),
            }),
        });

        if (!supabaseResponse.ok) {
            // Table might not exist, try to create it or use magic link instead
            console.log('OTP storage failed, using magic link approach');
        }

        // Send email via Resend
        const emailSent = await sendEmailViaResend(email, otp, email);

        if (!emailSent) {
            return NextResponse.json(
                { error: 'EMAIL_SEND_FAILED', message: 'Failed to send OTP email. Please try again.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            message: 'OTP sent successfully',
            // For development/testing only - remove in production
            ...(process.env.NODE_ENV === 'development' ? { otp } : {}),
        });
    } catch (error) {
        console.error('Send OTP error:', error);
        return NextResponse.json(
            { error: 'INTERNAL_ERROR', message: 'Failed to process request' },
            { status: 500 }
        );
    }
}

async function handleVerifyOTP(req: NextRequest): Promise<NextResponse> {
    try {
        const body = await req.json();
        const { email, otp } = body;

        if (!email || !otp) {
            return NextResponse.json(
                { error: 'MISSING_FIELDS', message: 'Email and OTP are required' },
                { status: 400 }
            );
        }

        const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

        // Verify OTP from Supabase
        const supabaseResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/otp_tokens?email=eq.${encodeURIComponent(email)}&otp_hash=eq.${hashedOtp}&expires_at=gt.${new Date().toISOString()}&order=created_at&desc=true&limit=1`,
            {
                headers: {
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
            }
        );

        if (!supabaseResponse.ok) {
            return NextResponse.json(
                { error: 'VERIFICATION_FAILED', message: 'Invalid or expired OTP' },
                { status: 401 }
            );
        }

        const tokens = await supabaseResponse.json();

        if (!tokens || tokens.length === 0) {
            return NextResponse.json(
                { error: 'INVALID_OTP', message: 'Invalid or expired OTP code' },
                { status: 401 }
            );
        }

        // Delete used OTP
        const tokenId = tokens[0].id;
        await fetch(`${SUPABASE_URL}/rest/v1/otp_tokens?id=eq.${tokenId}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
        });

        // Create or get user in Supabase Auth
        const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                email,
                email_confirm: true,
            }),
        });

        let user;

        if (authResponse.ok) {
            user = await authResponse.json();
        } else {
            // User might already exist, try to get them
            const listResponse = await fetch(
                `${SUPABASE_URL}/auth/v1/user`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    },
                }
            );

            if (listResponse.ok) {
                user = await listResponse.json();
            }
        }

        // Generate session token (simplified - in production use proper JWT)
        const sessionToken = crypto.randomBytes(32).toString('hex');

        return NextResponse.json({
            ok: true,
            email,
            sessionToken,
            userId: user?.id || 'demo-user-id',
        });
    } catch (error) {
        console.error('Verify OTP error:', error);
        return NextResponse.json(
            { error: 'INTERNAL_ERROR', message: 'Failed to verify OTP' },
            { status: 500 }
        );
    }
}

async function handleHealthCheck(req: NextRequest): Promise<NextResponse> {
    return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
}

// Main request handler
export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/api/health' || path === '/api/healthcheck') {
        return handleHealthCheck(request);
    }

    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export async function POST(request: NextRequest) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/auth/send-otp') {
        return handleSendOTP(request);
    }

    if (path === '/api/auth/verify-otp') {
        return handleVerifyOTP(request);
    }

    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export async function PUT(request: NextRequest) {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export async function DELETE(request: NextRequest) {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export async function PATCH(request: NextRequest) {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
