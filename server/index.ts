/**
 * Express API Server - 安全代理层
 * 所有敏感 API Key 仅在此服务器端使用，不暴露给前端
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { geminiRouter } from './routes/gemini';
import { replicateRouter } from './routes/replicate';

// 加载 .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.API_SERVER_PORT || 3002;

// 中间件
// ★ SECURITY: Restrict origins in production; allow all only in development
const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [
        'https://ai-cine-director.vercel.app',
        'https://aidirector.business',
        /\.vercel\.app$/,
      ]
    : true;
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' })); // 支持 base64 图片上传

// --- Helper Functions ---
const getSupabaseAdmin = () => {
    const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    return createClient(url, key);
};

const isUserAlreadyExistsError = (errorLike: any): boolean => {
    const msg = String(errorLike?.message || errorLike || '').toLowerCase();
    return msg.includes('already registered')
        || msg.includes('has already been registered')
        || msg.includes('user already registered')
        || msg.includes('already exists');
};

const findUserIdByEmail = async (supabaseAdmin: any, email: string): Promise<string | undefined> => {
    const target = email.toLowerCase();
    const perPage = 1000;

    for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) {
            console.error('[Auth Ensure User] listUsers failed:', error);
            return undefined;
        }

        const users = (data as any)?.users as Array<{ id: string; email?: string }> | undefined;
        if (!users?.length) return undefined;

        const match = users.find((u) => (u.email || '').toLowerCase() === target);
        if (match?.id) return match.id;

        if (users.length < perPage) return undefined;
    }

    return undefined;
};

// --- Auth Routes ---

// POST /api/auth/send-otp  — generate magic-link via Admin API, extract OTP token, email it via Resend
app.post('/api/auth/send-otp', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const resendKey = process.env.RESEND_API_KEY;
        if (!resendKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

        const supabaseAdmin = getSupabaseAdmin();

        // 1) Ensure user exists
        let userId = await findUserIdByEmail(supabaseAdmin, email);
        if (!userId) {
            const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true,
            });
            if (error && !isUserAlreadyExistsError(error)) {
                console.error('[Send OTP] Create user failed:', error);
                return res.status(500).json({ error: error.message });
            }
            userId = createdUser?.user?.id || await findUserIdByEmail(supabaseAdmin, email);
        }

        // 2) Generate magic link (Admin API — does NOT send email itself)
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email,
        });

        if (linkError || !linkData) {
            console.error('[Send OTP] generateLink failed:', linkError);
            return res.status(500).json({ error: linkError?.message || 'Failed to generate link' });
        }

        const otp = linkData.properties?.hashed_token
            ? undefined
            : linkData.properties?.verification_token;

        // Extract OTP from action_link query param as fallback
        const actionLink = linkData.properties?.action_link || '';
        const urlToken = new URL(actionLink).searchParams.get('token') || '';

        // The 6-digit OTP is in the email_otp field or we use the full token for magic-link verify
        const emailOtp = (linkData as any).properties?.email_otp
            || (linkData as any).user?.confirmation_token
            || otp
            || urlToken;

        console.log('[Send OTP] Generated for:', email, '| has token:', !!emailOtp, '| has action_link:', !!actionLink);

        // 3) Send email via Resend HTTP API
        const redirectTo = req.body?.redirectTo || 'https://ai-cine-director.vercel.app';
        const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 24px; font-weight: 800; color: #111; margin: 0;">🎬 CINE-DIRECTOR AI</h1>
                    <p style="color: #666; font-size: 12px; letter-spacing: 2px; margin-top: 4px;">VISIONARY PRODUCTION SUITE</p>
                </div>
                <div style="background: #f8f9fa; border-radius: 16px; padding: 32px; text-align: center;">
                    <h2 style="font-size: 20px; color: #111; margin: 0 0 12px;">Your Login Code</h2>
                    ${emailOtp ? `<div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: white; border-radius: 12px; padding: 16px; margin: 16px 0; font-family: monospace;">${emailOtp}</div>` : ''}
                    <p style="color: #666; font-size: 14px; margin: 16px 0 0;">Or click the button below:</p>
                    <a href="${actionLink}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 32px; border-radius: 999px; font-weight: 700; font-size: 14px; margin-top: 16px;">Log In to Studio</a>
                </div>
                <p style="color: #999; font-size: 11px; text-align: center; margin-top: 24px;">This link expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
        `;

        const resendResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'AI Cine Director <noreply@aidirector.business>',
                to: email,
                subject: 'Your Login Code — CINE-DIRECTOR AI',
                html: emailHtml,
            }),
        });

        if (!resendResp.ok) {
            const errBody = await resendResp.text();
            console.error('[Send OTP] Resend API error:', resendResp.status, errBody);
            return res.status(500).json({ error: 'Failed to send email via Resend' });
        }

        const resendData = await resendResp.json();
        console.log('[Send OTP] Email sent via Resend:', resendData);

        // Ensure profile exists
        if (userId) {
            await supabaseAdmin.from('profiles').upsert({
                id: userId, name: email, role: 'Director', credits: 50,
            }, { onConflict: 'id' }).then(() => {});
        }

        return res.json({ ok: true, message: 'Verification email sent' });
    } catch (err: any) {
        console.error('[Send OTP] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
});

app.post('/api/auth/ensure-user', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const supabaseAdmin = getSupabaseAdmin();

        // 1) First try lookup (for already-registered users)
        let userId = await findUserIdByEmail(supabaseAdmin, email);

        // 2) If not found, create user (idempotent fallback)
        if (!userId) {
            const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true
            });

            if (error && !isUserAlreadyExistsError(error)) {
                console.error('[Auth Ensure User] Failed:', error);
                return res.status(500).json({ error: error.message || 'Failed to ensure user' });
            }

            userId = createdUser?.user?.id || await findUserIdByEmail(supabaseAdmin, email);
        }

        if (userId) {
            // Keep this best-effort: some deployed DBs may not have role column yet.
            const { error: upsertErr } = await supabaseAdmin
                .from('profiles')
                .upsert({
                    id: userId,
                    name: email,
                    role: 'Director',
                    credits: 50,
                }, { onConflict: 'id' });

            if (upsertErr) {
                const { error: fallbackUpsertErr } = await supabaseAdmin
                    .from('profiles')
                    .upsert({
                        id: userId,
                        name: email,
                        credits: 50,
                    }, { onConflict: 'id' });

                if (fallbackUpsertErr) {
                    console.error('[Auth Ensure User] Profile upsert failed:', fallbackUpsertErr);
                }
            }
        }

        return res.json({ ok: true });
    } catch (err: any) {
        console.error('[Auth Ensure User] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to ensure user' });
    }
});

// --- Diagnostic Routes ---
app.post('/api/auth/test-email', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const supabaseAdmin = getSupabaseAdmin();

        console.log(`[Test Email] Attempting to send OTP to: ${email}`);

        // Try to send OTP directly
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: email,
            options: {
                redirectTo: 'http://localhost:3000'
            }
        });

        if (error) {
            console.error('[Test Email] Error:', error);
            return res.status(500).json({ 
                error: error.message || 'Failed to generate link',
                details: error
            });
        }

        console.log('[Test Email] Success! Link generated:', data?.properties?.action_link?.substring(0, 50) + '...');
        return res.json({ 
            ok: true, 
            message: 'Magic link generated successfully',
            link: data?.properties?.action_link?.substring(0, 50) + '...'
        });
    } catch (err: any) {
        console.error('[Test Email] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to test email' });
    }
});

// 路由
app.use('/api/gemini', geminiRouter);
app.use('/api/replicate', replicateRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        geminiKey: !!process.env.GEMINI_API_KEY ? '✅ configured' : '❌ missing',
        replicateToken: !!process.env.REPLICATE_API_TOKEN ? '✅ configured' : '❌ missing',
    });
});

// For Vercel Serverless (Export the app)
export default app;

// For Local Development (Run the server)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n🎬 AI Cine Director API Server`);
        console.log(`   Running on http://localhost:${PORT}`);
        console.log(`   Gemini Key: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}`);
        console.log(`   Replicate Token: ${process.env.REPLICATE_API_TOKEN ? '✅' : '❌'}\n`);
    });
}
