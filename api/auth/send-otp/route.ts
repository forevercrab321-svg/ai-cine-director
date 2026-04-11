/**
 * Mock Send OTP API - For Testing
 * POST /api/auth/send-otp
 */
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
    try {
        const body = await req.json();
        const email = body.email?.trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return new Response(JSON.stringify({
                error: 'INVALID_EMAIL',
                message: 'Please provide a valid email address'
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Mock success response
        return new Response(JSON.stringify({
            ok: true,
            message: 'OTP sent successfully (MOCK)',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Send OTP error:', error);
        return new Response(JSON.stringify({
            error: 'INTERNAL_ERROR',
            message: 'Failed to process request'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
