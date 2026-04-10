/**
 * Send OTP API Handler
 * POST /api/auth/send-otp
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 10;

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

export async function POST(req: NextRequest) {
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

        // Send email via Resend
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'AI Cine Director <noreply@ai-cine-director.com>',
                to: [email],
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

        if (!response.ok) {
            console.error('Resend API error:', await response.text());
            return NextResponse.json(
                { error: 'EMAIL_SEND_FAILED', message: 'Failed to send OTP email. Please try again.' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            message: 'OTP sent successfully',
        });
    } catch (error) {
        console.error('Send OTP error:', error);
        return NextResponse.json(
            { error: 'INTERNAL_ERROR', message: 'Failed to process request' },
            { status: 500 }
        );
    }
}
