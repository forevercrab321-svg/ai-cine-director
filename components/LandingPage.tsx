import React from 'react';
import { BUSINESS_PLANS } from '../types';
import { SparklesIcon } from './IconComponents';
import { supabase } from '../lib/supabaseClient';
import { t } from '../i18n';
import type { Language } from '../types';

interface LandingPageProps {
  onGetStarted: () => void;
  onOpenPricing?: () => void;
  lang: 'en' | 'zh';
}

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onOpenPricing, lang }) => {
  // Check if backend is available on mount
  const [backendStatus, setBackendStatus] = React.useState<'up' | 'down' | 'loading'>('loading');

  React.useEffect(() => {
    // Fast ping to check entitlement/health
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/entitlement');
        // 401 is actually UP (middleware reached, just no token)
        // 500 or network error is DOWN
        if (res.status === 401 || res.ok) {
          setBackendStatus('up');
        } else {
          setBackendStatus('down');
        }
      } catch (e) {
        setBackendStatus('down');
      }
    };
    checkHealth();
  }, []);

  const [showLogin, setShowLogin] = React.useState(false);
  const [showUpload, setShowUpload] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState('');
  const [uploadError, setUploadError] = React.useState('');
  const [demoVideoUrl, setDemoVideoUrl] = React.useState<string | null>(null);
  const [isDeveloper, setIsDeveloper] = React.useState(false);

  // Login form states
  const [email, setEmail] = React.useState('');
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginSent, setLoginSent] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');

  // Handle video upload
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a video file');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setUploadError('Video file too large. Maximum 50MB.');
      return;
    }

    setUploadProgress('Reading file...');
    setUploadError('');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        setUploadProgress('Uploading...');

        const token = localStorage.getItem('supabase.auth.token');
        let authHeader = '';
        try {
          const parsed = JSON.parse(token || '{}');
          if (parsed.access_token) {
            authHeader = `Bearer ${parsed.access_token}`;
          }
        } catch { }

        if (!authHeader) {
          setUploadError(t(lang, 'loginToUpload'));
          setUploadProgress('');
          return;
        }

        try {
          const res = await fetch('/api/upload-demo-video', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify({
              videoBase64: base64,
              fileName: file.name
            })
          });

          const data = await res.json();

          if (data.ok && data.url) {
            setDemoVideoUrl(data.url);
            setUploadProgress('Upload successful!');
            setTimeout(() => {
              setShowUpload(false);
              setUploadProgress('');
            }, 1500);
          } else {
            setUploadError(data.error || 'Upload failed');
            setUploadProgress('');
          }
        } catch (err: any) {
          setUploadError(err.message || 'Upload failed');
          setUploadProgress('');
        }
      };
      reader.onerror = () => {
        setUploadError('Failed to read file');
        setUploadProgress('');
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
      setUploadProgress('');
    }
  };

  // Handle send verification code
  const handleSendCode = async () => {
    if (!email) return;
    setLoginLoading(true);
    setLoginError('');

    try {
      console.log('[Landing] Sending Magic Link via backend to:', email);

      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        console.error('[Landing] Backend error:', data);
        throw new Error(data.error || t(lang, 'errorSendFailed'));
      }

      console.log('[Landing] Magic link sent successfully!');
      setLoginSent(true);
    } catch (e: any) {
      console.error('[Landing] OTP Error:', e);
      setLoginError(e.message || t(lang, 'errorNetworkRetry'));
    } finally {
      setLoginLoading(false);
    }
  };

  // Reset login form
  const resetLoginForm = () => {
    setShowLogin(false);
    setLoginSent(false);
    setEmail('');
    setLoginError('');
    setOtpCode('');
  };

  // Resend the magic link
  const handleResendCode = async () => {
    if (!email) return;
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        throw new Error(data.error || t(lang, 'errorSendFailed'));
      }

      alert(t(lang, 'magicLinkSent'));
    } catch (e: any) {
      console.error('[Landing] Resend Error:', e);
      setLoginError(e.message || t(lang, 'errorNetworkRetry'));
    } finally {
      setLoginLoading(false);
    }
  };

  // ═══ LOGIN FORM VIEW ═══
  if (showLogin) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="p-3 bg-indigo-600 rounded-xl inline-block mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white">{t(lang, 'signInTitle')}</h1>
            <p className="text-slate-400 mt-2">{loginSent ? t(lang, 'checkEmail') : t(lang, 'signInSubtitle')}</p>
          </div>

          {!loginSent ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <p className="text-sm text-slate-400 mb-4">{t(lang, 'emailPrompt')}</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(lang, 'emailPlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white mb-4"
              />
              {loginError && <p className="text-red-400 text-sm mb-4">{loginError}</p>}
              <button
                onClick={handleSendCode}
                disabled={loginLoading || !email}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold rounded-lg"
              >
                {loginLoading ? t(lang, 'sendingCode') : t(lang, 'sendVerificationCode')}
              </button>
              <p className="text-xs text-slate-500 mt-4 text-center">
                {t(lang, 'termsNote')}
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <p className="text-sm text-slate-400 mb-4">{t(lang, 'enterOtpPrompt')}</p>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={t(lang, 'otpPlaceholderShort')}
                maxLength={8}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white mb-4 text-center text-xl tracking-[0.5em] font-mono"
              />
              {loginError && <p className="text-red-400 text-sm mb-4">{loginError}</p>}
              <button
                onClick={async () => {
                  if (!otpCode || otpCode.length < 6) {
                    setLoginError(t(lang, 'enterOtpMin'));
                    return;
                  }
                  setLoginLoading(true);
                  setLoginError('');
                  try {
                    const { error } = await supabase.auth.verifyOtp({
                      email: email,
                      token: otpCode,
                      type: 'magiclink'
                    });
                    if (error) {
                      const { error: emailError } = await supabase.auth.verifyOtp({
                        email: email,
                        token: otpCode,
                        type: 'email'
                      });
                      if (emailError) throw emailError;
                    }
                  } catch (e: any) {
                    console.error('[Landing] OTP verify error:', e);
                    setLoginError(e.message || t(lang, 'otpInvalid'));
                  } finally {
                    setLoginLoading(false);
                  }
                }}
                disabled={loginLoading || otpCode.length < 8}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold rounded-lg"
              >
                {loginLoading ? t(lang, 'verifying') : t(lang, 'confirmLogin')}
              </button>
              <button
                onClick={handleResendCode}
                disabled={loginLoading}
                className="w-full py-2 text-indigo-400 text-sm mt-3"
              >
                {loginLoading ? t(lang, 'resending') : t(lang, 'resendCode')}
              </button>
              <button
                onClick={resetLoginForm}
                className="w-full py-2 text-slate-500 text-sm"
              >
                {t(lang, 'useOtherEmail')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ MAIN LANDING PAGE ═══
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* ── Top Nav with Sign In ── */}
      <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-600 rounded-lg">
            <SparklesIcon className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm">AI Cine Director</span>
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="px-5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-semibold rounded-lg transition-all"
        >
          {lang === 'zh' ? '登录 / 注册' : 'Sign In / Sign Up'}
        </button>
      </nav>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-slate-950 to-purple-900/20" />

        <div className="relative max-w-6xl mx-auto px-6 py-20">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/30">
              <SparklesIcon className="w-8 h-8 text-white" />
            </div>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white text-center mb-6 tracking-tight">
            AI Cine-Director
          </h1>

          <p className="text-xl text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            {t(lang, 'heroSubtitle')}
          </p>

          {/* CTA Buttons */}
          <div className="text-center mb-16">
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <button
                onClick={() => setShowLogin(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-10 rounded-full text-lg shadow-xl shadow-indigo-500/20 transition-all flex items-center gap-2 group"
              >
                {t(lang, 'ctaGetStarted')}
                <SparklesIcon className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              </button>
              <a
                href="mailto:sales@aidirector.business?subject=Enterprise Inquiry"
                className="px-8 py-4 bg-transparent border-2 border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-lg font-bold rounded-full transition-all"
              >
                {t(lang, 'ctaContactSales')}
              </a>
              <button
                onClick={() => { console.log('[Landing] Upload clicked'); setShowUpload(true); }}
                className="px-6 py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-full transition-all shadow-lg shadow-emerald-500/30"
              >
                {t(lang, 'ctaUploadDemo')}
              </button>
            </div>
            <p className="text-sm text-slate-500 mt-4">
              {t(lang, 'noCreditCard')}
            </p>
          </div>

          {/* Demo Video */}
          <div className="max-w-4xl mx-auto mb-20">
            <div className="aspect-video bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden relative">
              <video
                className="w-full h-full object-cover"
                controls
                poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Crect fill='%231e293b' width='1920' height='1080'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='24'%3EDemo Video%3C/text%3E%3C/svg%3E"
              >
                <source src={demoVideoUrl || "https://gtxgkdsayswonlewqfzj.supabase.co/storage/v1/object/public/videos/demo/demo.mp4"} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            <p className="text-center text-slate-500 text-sm mt-4">
              {t(lang, 'demoCaption')}
            </p>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          {t(lang, 'whyChoose')}
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">🎬</div>
            <h3 className="text-xl font-bold text-white mb-2">{t(lang, 'featureConsistencyTitle')}</h3>
            <p className="text-slate-400 text-sm">{t(lang, 'featureConsistencyDesc')}</p>
          </div>

          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">⚡</div>
            <h3 className="text-xl font-bold text-white mb-2">{t(lang, 'featureWorkflowTitle')}</h3>
            <p className="text-slate-400 text-sm">{t(lang, 'featureWorkflowDesc')}</p>
          </div>

          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">🎥</div>
            <h3 className="text-xl font-bold text-white mb-2">{t(lang, 'featureMultiModelTitle')}</h3>
            <p className="text-slate-400 text-sm">{t(lang, 'featureMultiModelDesc')}</p>
          </div>
        </div>
      </div>

      {/* Pricing Preview */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          {t(lang, 'pricingTitle')}
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {BUSINESS_PLANS.map((plan, index) => (
            <div key={plan.id} className={`bg-slate-900/50 p-6 rounded-xl border ${plan.popular ? 'border-indigo-500/50 bg-indigo-900/20' : 'border-slate-800'} text-center relative`}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs px-3 py-1 rounded-full">
                  {t(lang, 'mostPopular')}
                </div>
              )}
              <h3 className="text-lg font-bold text-white mb-2">{lang === 'zh' ? plan.nameZh : plan.name}</h3>
              <p className="text-3xl font-bold text-indigo-400 mb-4">${plan.priceMonthly}<span className="text-sm text-slate-400">{t(lang, 'perMonth')}</span></p>
              <p className="text-slate-400 text-sm mb-4">{plan.creditsMonthly.toLocaleString()} {t(lang, 'creditsPerMonth')}</p>
              <ul className="text-xs text-slate-500 mb-4 space-y-1">
                {(lang === 'zh' ? plan.features : plan.featuresEn).slice(0, 4).map((f, i) => (
                  <li key={i}>✓ {f}</li>
                ))}
              </ul>
              <button
                onClick={() => onOpenPricing?.()}
                className={`w-full py-2 rounded-lg text-sm ${plan.popular ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'} text-white transition-colors`}
              >
                {t(lang, 'subscribeNow')}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-slate-500 text-sm">
          <p>{t(lang, 'copyright')}</p>
        </div>
      </div>

      {/* Upload Demo Video Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl p-6">
            <button
              onClick={() => { setShowUpload(false); setUploadError(''); setUploadProgress(''); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-bold text-white mb-4">{t(lang, 'uploadTitle')}</h3>
            <p className="text-slate-400 text-sm mb-6">
              {t(lang, 'uploadDesc')}
            </p>

            <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center mb-4">
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                className="hidden"
                id="video-upload"
                disabled={!!uploadProgress}
              />
              <label htmlFor="video-upload" className="cursor-pointer">
                <div className="text-4xl mb-2">🎬</div>
                <p className="text-white font-medium">
                  {uploadProgress || t(lang, 'selectVideo')}
                </p>
                <p className="text-slate-500 text-xs mt-2">{t(lang, 'maxFileSize')}</p>
              </label>
            </div>

            {uploadError && (
              <p className="text-red-400 text-sm mb-4 text-center">{uploadError}</p>
            )}

            <button
              onClick={() => { setShowUpload(false); setUploadError(''); setUploadProgress(''); }}
              className="w-full py-2 text-slate-400 hover:text-white text-sm"
            >
              {t(lang, 'cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
