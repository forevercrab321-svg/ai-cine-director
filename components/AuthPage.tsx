import React, { useState, useEffect } from 'react';
import { SparklesIcon, LoaderIcon } from './IconComponents';
import { Language } from '../types';
import { t } from '../i18n';
import { supabase } from '../lib/supabaseClient';
import { isDeveloperEmail } from '../context/AppContext';

interface AuthPageProps {
  lang: Language;
  onLogin: (bypass?: boolean) => void;
  onCompleteProfile: (name: string, role: string) => void;
  hasProfile: boolean;
}

const AuthPage: React.FC<AuthPageProps> = ({ lang, onLogin, onCompleteProfile, hasProfile }) => {
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
    if (!agreed) {
      alert(t(lang, 'agreeTerms'));
      return;
    }
    callback();
  };

  const sendOtpWithFallback = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: origin,
      }
    });

    if (!error) return;

    // If signups are disabled or user doesn't exist, pre-create via server and retry once
    const isRateLimit = error?.status === 429 || error?.message?.includes('Too Many');
    if (isRateLimit) throw error;

    const ensureResp = await fetch('/api/auth/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!ensureResp.ok) {
      const data = await ensureResp.json();
      throw new Error(data?.error || 'Failed to ensure user');
    }

    const { error: retryError } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: origin,
      }
    });

    if (retryError) throw retryError;
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isEmail) {
      setValidationError(t(lang, 'invalidContact') + " (请输入有效邮箱)");
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
        await sendOtpWithFallback();

        setStep('otp');
        setCountdown(60);
      } catch (error: any) {
        const msg = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('Too Many')
          ? '发送太频繁，请稍后再试'
          : (error.message || '发送验证码失败');
        setValidationError(msg);
      } finally {
        setIsLoading(false);
      }
    });
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 6) return; // Supabase OTP 可能是 6 或 8 位

    setIsLoading(true);

    handleAction(async () => {
      try {
        // 先尝试 magiclink 类型（signInWithOtp 发送的是 magic link）
        const { error } = await supabase.auth.verifyOtp({
          email: email,
          token: otp,
          type: 'magiclink'
        });

        if (error) {
          console.error('[Auth] magiclink verify failed:', error.message, error.status);
          // 如果 magiclink 失败，再尝试 email 类型
          const { error: emailError } = await supabase.auth.verifyOtp({
            email: email,
            token: otp,
            type: 'email'
          });
          if (emailError) {
            console.error('[Auth] email verify also failed:', emailError.message, emailError.status);
            throw emailError;
          }
        }
        // 验证成功，Auth state change 由 AppContext 捕获
      } catch (error: any) {
        console.error('[Auth] OTP verification error:', error);
        const msg = error?.status === 403 || error?.message?.includes('403')
          ? '验证码已过期或无效，请重新发送'
          : error?.status === 429 || error?.message?.includes('429')
            ? '验证太频繁，请稍后再试'
            : (error.message || '验证码无效，请重试');
        setValidationError(msg);
        setIsLoading(false);
      }
    });
  };


  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    onCompleteProfile(name, role);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden selection:bg-indigo-500/30">
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
                开发者模式
              </span>
            </div>
          )}

          {/* Dev Bypass Removed for Strict Auth */}
        </div>

        {/* Email 输入步骤 */}
        {step === 'email' && (
          <div className="w-full space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-white mb-2">欢迎登录</h2>
              <p className="text-slate-500 text-sm">输入您的邮箱，我们将发送验证码</p>
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
                {validationError && (
                  <p className="absolute -bottom-6 left-2 text-[10px] text-red-400 font-bold tracking-wide animate-in slide-in-from-top-1 flex items-center gap-1">
                    <span className="w-1 h-1 bg-red-400 rounded-full inline-block" /> {validationError}
                  </p>
                )}
              </div>
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
                  开发者账户 - 完整权限
                </p>
              </div>
            )}
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-4 text-center flex items-center justify-center gap-2">
                  验证码已发送至 <span className="text-white font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">{email}</span>
                </p>
                <div className="relative">
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="00000000"
                    maxLength={8}
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
              <button
                type="submit"
                disabled={isLoading || otp.length < 6}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {isLoading ? <LoaderIcon className="w-5 h-5" /> : t(lang, 'verifyCode')}
              </button>

              {/* Resend Timer */}
              <div className="text-center">
                {countdown > 0 ? (
                  <span className="text-[10px] text-slate-600 font-mono">重新发送 00:{countdown.toString().padStart(2, '0')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      setCountdown(60);
                      try {
                        await sendOtpWithFallback();
                      } catch (error: any) {
                        const msg = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('Too Many')
                          ? '发送太频繁，请稍后再试'
                          : (error.message || '发送验证码失败');
                        setValidationError(msg);
                      }
                    }}
                    className="text-[10px] text-indigo-400 hover:text-white font-bold uppercase tracking-wider transition-colors"
                  >
                    重新发送验证码
                  </button>
                )}
              </div>
            </form>

            <button onClick={() => { setStep('email'); setOtp(''); }} className="w-full text-slate-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] transition-colors">
              &larr; 返回
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
