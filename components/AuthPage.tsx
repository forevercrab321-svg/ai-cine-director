import React, { useState, useEffect } from 'react';
import { SparklesIcon, LoaderIcon } from './IconComponents';
import { Language } from '../types';
import { t } from '../i18n';
import { supabase } from '../lib/supabaseClient';
import { isDeveloperEmail } from '../context/AppContext';

// ─── Camera Boot Animation ───────────────────────────────────────────────────
// Simulates a cinema camera powering on: lens aperture opens → viewfinder
// overlays appear → CAMERA READY → fades to reveal the login form.
const CameraBootAnimation: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [stage, setStage] = useState(0);
  // stage 0 = black
  // stage 1 = lens/body fades in        (~200ms)
  // stage 2 = aperture opens            (~800ms)
  // stage 3 = viewfinder UI appears     (~1400ms)
  // stage 4 = CAMERA READY + fade-out  (~2200ms)
  // onComplete called at              ~3000ms

  // Store onComplete in a ref so the timer effect never re-runs when the parent
  // re-renders (which would recreate the inline arrow fn and restart the animation).
  const onCompleteRef = React.useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 200);
    const t2 = setTimeout(() => setStage(2), 800);
    const t3 = setTimeout(() => setStage(3), 1400);
    const t4 = setTimeout(() => setStage(4), 2200);
    const t5 = setTimeout(() => onCompleteRef.current(), 3000);
    return () => [t1, t2, t3, t4, t5].forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — intentional: timers run once per mount

  const tick = (i: number) => ({
    position: 'absolute' as const,
    width: '1px',
    height: '9px',
    top: '3px',
    left: '50%',
    background: 'rgba(255,255,255,0.18)',
    transformOrigin: '50% 93px',
    transform: `rotate(${i * 30}deg)`,
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        opacity: stage >= 4 ? 0 : 1,
        transition: 'opacity 0.75s ease-in-out',
        pointerEvents: stage >= 4 ? 'none' : 'auto',
      }}
    >
      {/* Custom keyframes injected inline */}
      <style>{`
        @keyframes cam-spin    { to { transform: rotate(360deg);  } }
        @keyframes cam-spin-r  { to { transform: rotate(-360deg); } }
        @keyframes cam-blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes cam-scan    {
          0%   { background-position: 0 0; }
          100% { background-position: 0 4px; }
        }
      `}</style>

      {/* Scanline texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 4px)',
        animation: 'cam-scan 0.1s linear infinite',
        opacity: 0.5,
      }} />

      {/* ── Lens Assembly ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px',
        opacity: stage >= 1 ? 1 : 0,
        transform: stage >= 1 ? 'scale(1)' : 'scale(0.55)',
        transition: 'opacity 0.6s ease-out, transform 0.7s cubic-bezier(0.34,1.4,0.64,1)',
      }}>

        {/* Outer lens ring */}
        <div style={{
          width: 176, height: 176, borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          boxShadow: stage >= 2 ? '0 0 80px -20px rgba(99,102,241,0.45)' : 'none',
          transition: 'box-shadow 1s ease',
        }}>

          {/* Rotating outer tick ring */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            animation: stage >= 2 ? 'cam-spin 14s linear infinite' : 'none',
          }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={tick(i)} />
            ))}
          </div>

          {/* Counter-rotating middle ring */}
          <div style={{
            position: 'absolute',
            width: 140, height: 140, borderRadius: '50%',
            border: '1px solid rgba(99,102,241,0.2)',
            animation: stage >= 2 ? 'cam-spin-r 7s linear infinite' : 'none',
          }}>
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <div key={deg} style={{
                position: 'absolute',
                width: 8, height: 1,
                background: 'rgba(99,102,241,0.35)',
                top: '50%',
                left: '50%',
                transformOrigin: '0 0',
                transform: `rotate(${deg}deg) translateX(68px)`,
              }} />
            ))}
          </div>

          {/* Inner lens barrel */}
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
            background: stage >= 2
              ? 'radial-gradient(circle, rgba(30,18,90,0.85) 0%, rgba(0,0,0,0.95) 70%)'
              : 'radial-gradient(circle, #000 0%, #000 100%)',
            transition: 'background 1.1s ease',
            boxShadow: stage >= 2 ? 'inset 0 0 28px rgba(99,102,241,0.2)' : 'none',
          }}>
            {/* Iris aperture (clip-path expanding circle) */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(55,35,140,0.5) 0%, rgba(15,8,50,0.7) 60%, transparent 100%)',
              clipPath: stage >= 2 ? 'circle(48% at 50% 50%)' : 'circle(0% at 50% 50%)',
              transition: 'clip-path 1.1s cubic-bezier(0.22,1,0.36,1)',
            }} />
            {/* Lens glare */}
            <div style={{
              position: 'absolute', top: 10, left: 16,
              width: 22, height: 10, borderRadius: '50%',
              background: 'rgba(255,255,255,0.07)',
              filter: 'blur(4px)',
              opacity: stage >= 2 ? 1 : 0,
              transition: 'opacity 0.8s ease 0.4s',
            }} />
            {/* Center glow dot */}
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: stage >= 2 ? 'rgba(130,100,255,0.9)' : 'transparent',
              boxShadow: stage >= 2 ? '0 0 12px 3px rgba(99,102,241,0.6)' : 'none',
              transition: 'all 0.8s ease 0.5s',
            }} />
          </div>
        </div>

        {/* Camera label */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.5em', textTransform: 'uppercase',
            fontFamily: 'monospace', color: 'rgba(255,255,255,0.28)',
            opacity: stage >= 1 ? 1 : 0,
            transition: 'opacity 0.5s ease 0.3s',
          }}>CINE-DIRECTOR AI</div>
          <div style={{
            fontSize: 7, letterSpacing: '0.3em', textTransform: 'uppercase',
            fontFamily: 'monospace', color: 'rgba(255,255,255,0.12)',
            marginTop: 4,
            opacity: stage >= 2 ? 1 : 0,
            transition: 'opacity 0.5s ease 0.2s',
          }}>PRODUCTION SUITE · INITIALIZING</div>
        </div>
      </div>

      {/* ── Viewfinder Overlay (stage 3+) ── */}
      {stage >= 3 && (
        <>
          {/* Corner brackets */}
          {([
            { top: 24, left: 24, borderTop: true, borderLeft: true },
            { top: 24, right: 24, borderTop: true, borderRight: true },
            { bottom: 24, left: 24, borderBottom: true, borderLeft: true },
            { bottom: 24, right: 24, borderBottom: true, borderRight: true },
          ] as any[]).map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', width: 32, height: 32,
              borderColor: 'rgba(255,255,255,0.22)',
              borderStyle: 'solid',
              borderTopWidth: pos.borderTop ? 1 : 0,
              borderBottomWidth: pos.borderBottom ? 1 : 0,
              borderLeftWidth: pos.borderLeft ? 1 : 0,
              borderRightWidth: pos.borderRight ? 1 : 0,
              top: pos.top, bottom: pos.bottom,
              left: pos.left, right: pos.right,
              animation: 'cam-spin-r 0s', /* trigger reflow */
            }} />
          ))}

          {/* REC indicator */}
          <div style={{
            position: 'absolute', top: 28, right: 52,
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#ef4444',
              animation: 'cam-blink 1.1s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
              color: 'rgba(248,113,113,0.75)',
              letterSpacing: '0.35em',
            }}>REC</span>
          </div>

          {/* Shot counter */}
          <div style={{ position: 'absolute', top: 28, left: 52 }}>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.3em' }}>SH 001</span>
          </div>

          {/* Timecode */}
          <div style={{ position: 'absolute', bottom: 30, left: 52 }}>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.22)', letterSpacing: '0.25em' }}>00:00:00:00</span>
          </div>

          {/* Frame rate */}
          <div style={{ position: 'absolute', bottom: 30, right: 52 }}>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.22)', letterSpacing: '0.25em' }}>24 FPS</span>
          </div>

          {/* Centre crosshair */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 28, height: 28,
          }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.12)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)' }} />
          </div>
        </>
      )}

      {/* ── CAMERA READY (stage 4) ── */}
      {stage >= 4 && (
        <div style={{
          position: 'absolute', bottom: '32%', left: 0, right: 0,
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
        }}>
          <div style={{ width: 32, height: 1, background: 'rgba(74,222,128,0.3)' }} />
          <span style={{
            fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
            color: 'rgba(74,222,128,0.65)',
            letterSpacing: '0.55em', textTransform: 'uppercase',
          }}>CAMERA READY</span>
          <div style={{ width: 32, height: 1, background: 'rgba(74,222,128,0.3)' }} />
        </div>
      )}
    </div>
  );
};

interface AuthPageProps {
  lang: Language;
  onLogin: (bypass?: boolean) => void;
  onCompleteProfile: (name: string, role: string) => void;
  hasProfile: boolean;
}

const AuthPage: React.FC<AuthPageProps> = ({ lang, onLogin, onCompleteProfile, hasProfile }) => {
  // Camera boot animation — show once per mount
  const [bootDone, setBootDone] = useState(false);

  const [step, setStep] = useState<'email' | 'otp' | 'profile'>('email');

  // Contact State
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isDeveloper, setIsDeveloper] = useState(false);

  // OTP State
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Profile State
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState('director@cine-ai.studio');
  const [role, setRole] = useState('Director');

  // Timer Effect
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleAction = (callback: () => void) => {
    // 只在 OTP 和 Profile 步骤检查 agreed
    // Email 步骤不需要 agreement
    if (step !== 'email' && !agreed) {
      alert(t(lang, 'agreeTerms'));
      return;
    }
    callback();
  };

  const isAlreadyRegisteredError = (errorLike: any): boolean => {
    const msg = String(errorLike?.message || errorLike || '').toLowerCase();
    return msg.includes('already registered')
      || msg.includes('has already been registered')
      || msg.includes('user already registered')
      || msg.includes('already exists');
  };

  const sendOtpWithFallback = async () => {
    console.log('[AUTH] Sending Magic Link via backend to:', email);

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email })
      });

      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: raw || 'Server returned non-JSON error' };
      }

      if (!res.ok) {
        console.error('[AUTH] Backend error:', data);
        throw new Error(data.error || 'Failed to send magic link');
      }

      console.log('[AUTH] Magic link sent successfully via backend!');
      return { success: true, message: 'Magic link sent!' };
    } catch (err: any) {
      console.error('[AUTH] Send OTP error:', err);
      throw err;
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isEmail) {
      setValidationError(t(lang, 'invalidContact'));
      return;
    }

    // ★ AUTO-DETECT DEVELOPER
    const devStatus = isDeveloperEmail(email);
    setIsDeveloper(devStatus);
    if (devStatus) {
      console.log(`[AUTH] Developer email detected: ${email}`);
    }

    handleAction(async () => {
      setIsLoading(true);
      try {
        // Developer mode bypasses OTP - login directly
        if (devStatus) {
          console.log('[AUTH] Developer mode - bypassing OTP, logging in directly');
          onLogin(true);
          return;
        }

        const res = await sendOtpWithFallback();
        if (res.success) {
          setStep('otp');
          setCountdown(60);
        }
      } catch (err: any) {
        console.error('[AUTH] Submit handling error:', err);
        const errCode = err.code || '';
        if (errCode === 'AUTH_CONFIG_MISSING') {
          setValidationError(t(lang, 'authConfigMissing'));
        } else if (errCode === 'EMAIL_SEND_FAILED') {
          setValidationError(t(lang, 'emailSendFailed'));
        } else if (err.message?.includes('429') || err.message?.includes('Too Many')) {
          setValidationError(lang === 'zh' ? '发送太频繁，请稍后再试' : 'Too many requests, please try again later');
        } else {
          setValidationError(err.message || t(lang, 'errorServerError'));
        }
      } finally {
        setIsLoading(false);
      }
    });
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();

    // 先检查 agreed
    if (!agreed) {
      alert(t(lang, 'agreeTerms'));
      return;
    }

    // 清除之前的错误
    setValidationError('');

    // 使用 setTimeout 延迟设置 loading，避免覆盖层挡住按钮点击
    const loadingTimer = setTimeout(() => {
      setIsLoading(true);
    }, 100);

    // 直接执行验证
    (async () => {
      try {
        // 使用自定义 API 验证 OTP
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || data.error || 'Verification failed');
        }

        // 保存 session token 到 localStorage
        if (data.sessionToken) {
          localStorage.setItem('auth_session_token', data.sessionToken);
          localStorage.setItem('auth_user_id', data.userId || '');
        }

        console.log('[Auth] OTP verified successfully via custom API!');
        // 验证成功，登录
        clearTimeout(loadingTimer);
        setIsLoading(false);
        onLogin(true);
      } catch (error: any) {
        console.error('[Auth] OTP verification error:', error);
        clearTimeout(loadingTimer);
        setIsLoading(false); // 失败时也要重置

        const msg = error?.status === 403 || error?.message?.includes('403')
          ? (lang === 'zh' ? '验证码已过期或无效，请重新发送' : 'Code expired or invalid, please resend')
          : error?.status === 429 || error?.message?.includes('429')
            ? (lang === 'zh' ? '验证太频繁，请稍后再试' : 'Too many attempts, please try again later')
            : (error.message || t(lang, 'otpInvalid'));
        setValidationError(msg);
      }
    })();
  };


  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    onCompleteProfile(name, role);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden selection:bg-indigo-500/30">
      {/* Camera boot animation — unmounts after sequence completes */}
      {!bootDone && <CameraBootAnimation onComplete={() => setBootDone(true)} />}

      {/* Cinematic Aura - Animated */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none animate-pulse duration-[5000ms]" />

      <div className="w-full max-w-sm flex flex-col items-center relative z-10 animate-in fade-in zoom-in-95 duration-700">

        {/* LOGO */}
        <div className="mb-12 flex flex-col items-center group cursor-default">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] mb-6 transition-transform group-hover:scale-105 duration-500">
            <SparklesIcon className="w-10 h-10 text-black" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tighter mb-1">CINE-DIRECTOR AI</h1>
          <p className="text-slate-500 text-[10px] tracking-[0.3em] uppercase font-bold">Visionary Production Suite</p>

          {/* ★ DEVELOPER MODE INDICATOR */}
          {isDeveloper && step === 'email' && (
            <div className="mt-6 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/50 rounded-full animate-pulse">
              <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                {lang === 'zh' ? '开发者模式' : 'Developer Mode'}
              </span>
            </div>
          )}

          {/* Dev Bypass Removed for Strict Auth */}
        </div>

        {/* Email 输入步骤 */}
        {step === 'email' && (
          <div className="w-full space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-white mb-2">{lang === 'zh' ? '欢迎登录' : 'Welcome'}</h2>
              <p className="text-slate-500 text-sm">{lang === 'zh' ? '输入您的邮箱，我们将发送验证码' : 'Enter your email to receive a verification code'}</p>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (validationError) setValidationError('');
                  }}
                  placeholder="your@email.com"
                  className={`w-full bg-slate-900/50 border rounded-2xl px-6 py-4 text-white outline-none transition-all placeholder-slate-600 font-medium
                       ${validationError
                      ? 'border-red-500/50 focus:border-red-500 focus:shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                      : 'border-slate-800 focus:border-indigo-500 focus:shadow-[0_0_15px_rgba(99,102,241,0.2)]'}
                    `}
                  required
                />
              </div>
              {validationError && (
                <p className="text-[11px] text-red-400 font-bold tracking-wide animate-in slide-in-from-top-1 flex items-start gap-1 leading-4 break-words px-2">
                  <span className="w-1 h-1 bg-red-400 rounded-full inline-block mt-1.5 shrink-0" />
                  <span>{validationError}</span>
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-white hover:bg-slate-100 text-black rounded-full font-bold transition-all shadow-lg flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? <LoaderIcon className="w-5 h-5" /> : t(lang, 'sendCode')}
              </button>
            </form>
          </div>
        )}

        {/* OTP 验证步骤 */}
        {step === 'otp' && (
          <div className="w-full space-y-6 animate-in slide-in-from-right-8 fade-in duration-300">
            {/* ★ DEVELOPER MODE INDICATOR */}
            {isDeveloper && (
              <div className="px-4 py-2.5 bg-emerald-500/15 border border-emerald-500/50 rounded-2xl">
                <p className="text-[11px] font-bold text-emerald-400 tracking-widest uppercase flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  {lang === 'zh' ? '开发者账户 - 完整权限' : 'Developer Account — Full Access'}
                </p>
              </div>
            )}
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-4 text-center flex items-center justify-center gap-2">
                  {lang === 'zh' ? '验证码已发送至' : 'Code sent to'} <span className="text-white font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">{email}</span>
                </p>
                <div className="relative">
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                    className="w-full bg-slate-900/50 border border-indigo-500/50 rounded-2xl px-6 py-4 text-center text-2xl tracking-[0.3em] text-white focus:border-indigo-500 focus:shadow-[0_0_20px_rgba(99,102,241,0.3)] outline-none transition-all font-mono"
                    required
                  />
                </div>
              </div>
              {validationError && (
                <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <span className="w-1 h-1 bg-red-400 rounded-full inline-block" /> {validationError}
                </p>
              )}
              {/* Agreement Checkbox */}
              <div className="flex items-start gap-3 px-2">
                <button
                  type="button"
                  onClick={() => setAgreed(!agreed)}
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all duration-300 mt-0.5
                        ${agreed
                      ? 'bg-white border-white shadow-[0_0_15px_rgba(255,255,255,0.4)]'
                      : 'border-slate-700 bg-transparent hover:border-slate-500'}
                      `}
                >
                  {agreed && <svg className="w-3 h-3 text-black" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                </button>
                <p className={`text-[10px] leading-relaxed transition-colors duration-300 cursor-pointer select-none ${agreed ? 'text-slate-400' : 'text-slate-600'}`} onClick={() => setAgreed(!agreed)}>
                  {t(lang, 'agreeTerms')}
                </p>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {isLoading ? <LoaderIcon className="w-5 h-5 animate-spin" /> : (lang === 'zh' ? '确认并登录' : 'Confirm & Login')}
              </button>

              {/* Resend Timer */}
              <div className="text-center">
                {countdown > 0 ? (
                  <span className="text-[10px] text-slate-600 font-mono">{lang === 'zh' ? '重新发送' : 'Resend in'} 00:{countdown.toString().padStart(2, '0')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      setCountdown(60);
                      try {
                        await sendOtpWithFallback();
                      } catch (error: any) {
                        const msg = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('Too Many')
                          ? (lang === 'zh' ? '发送太频繁，请稍后再试' : 'Too many requests, please wait')
                          : (error.message || (lang === 'zh' ? '发送验证码失败' : 'Failed to send code'));
                        setValidationError(msg);
                      }
                    }}
                    className="text-[10px] text-indigo-400 hover:text-white font-bold uppercase tracking-wider transition-colors"
                  >
                    {lang === 'zh' ? '重新发送验证码' : 'Resend Code'}
                  </button>
                )}
              </div>
            </form>

            <button onClick={() => { setStep('email'); setOtp(''); }} className="w-full text-slate-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] transition-colors">
              &larr; {lang === 'zh' ? '返回' : 'Back'}
            </button>
          </div>
        )}

        {/* Profile 完善步骤 */}
        {step === 'profile' && (
          <form onSubmit={handleProfileSubmit} className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-2">{t(lang, 'directorName')}</label>
                <div className="relative group">
                  <select
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:border-indigo-500 outline-none transition-all appearance-none cursor-pointer group-hover:border-slate-700"
                  >
                    <option value="director@cine-ai.studio">director@cine-ai.studio</option>
                    <option value="producer@cine-ai.studio">producer@cine-ai.studio</option>
                    <option value="art@cine-ai.studio">art@cine-ai.studio</option>
                    <option value="writer@cine-ai.studio">writer@cine-ai.studio</option>
                  </select>
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover:text-indigo-400 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-2">{t(lang, 'directorRole')}</label>
                <div className="relative group">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:border-indigo-500 outline-none transition-all appearance-none cursor-pointer group-hover:border-slate-700"
                  >
                    <option value="Director">{t(lang, 'roleDirector')}</option>
                    <option value="Producer">{t(lang, 'roleProducer')}</option>
                    <option value="Writer">{t(lang, 'roleWriter')}</option>
                    <option value="Artist">{t(lang, 'roleArtist')}</option>
                  </select>
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover:text-indigo-400 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-full text-white font-bold transition-all shadow-[0_0_30px_-5px_rgba(79,70,229,0.4)] flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? <LoaderIcon className="w-5 h-5" /> : t(lang, 'enterStudio')}
            </button>
          </form>
        )}

        {/* Legal Consent Footer */}
        {step !== 'profile' && (
          <div className="mt-20 flex items-start gap-3 max-w-[280px]">
            <button
              onClick={() => setAgreed(!agreed)}
              className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all duration-300
                    ${agreed
                  ? 'bg-white border-white shadow-[0_0_15px_rgba(255,255,255,0.4)]'
                  : 'border-slate-700 bg-transparent hover:border-slate-500'}
                  `}
            >
              {agreed && <svg className="w-3 h-3 text-black" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
            </button>
            <p className={`text-[10px] leading-relaxed transition-colors duration-300 cursor-pointer select-none ${agreed ? 'text-slate-400' : 'text-slate-600'}`} onClick={() => setAgreed(!agreed)}>
              {t(lang, 'agreeTerms')}
            </p>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-[6px] z-[100] flex items-center justify-center animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-t-2 border-indigo-500 border-solid rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 bg-indigo-500/20 rounded-full animate-pulse"></div>
              </div>
            </div>
            <span className="text-xs font-bold text-white tracking-[0.3em] uppercase animate-pulse">{t(lang, 'bindingAccount')}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPage;
