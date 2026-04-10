import React from 'react';
import { BUSINESS_PLANS } from '../types';
import { SparklesIcon } from './IconComponents';
import { supabase } from '../lib/supabaseClient';

interface LandingPageProps {
  onGetStarted: () => void;
  onOpenPricing?: () => void;
  lang: 'en' | 'zh';
}

const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onOpenPricing, lang }) => {
  const [showLogin, setShowLogin] = React.useState(false);
  const [showUpload, setShowUpload] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState('');
  const [uploadError, setUploadError] = React.useState('');
  const [demoVideoUrl, setDemoVideoUrl] = React.useState<string | null>(null);
  const [isDeveloper, setIsDeveloper] = React.useState(false);

  // Login form states - MOVED TO TOP LEVEL to avoid React hooks violation
  const [email, setEmail] = React.useState('');
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginSent, setLoginSent] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');

  // Handle video upload
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a video file');
      return;
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setUploadError('Video file too large. Maximum 50MB.');
      return;
    }

    setUploadProgress('Reading file...');
    setUploadError('');

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        setUploadProgress('Uploading...');

        // Get auth token from localStorage or session
        const token = localStorage.getItem('supabase.auth.token');
        let authHeader = '';
        try {
          const parsed = JSON.parse(token || '{}');
          if (parsed.access_token) {
            authHeader = `Bearer ${parsed.access_token}`;
          }
        } catch { }

        if (!authHeader) {
          setUploadError('Please login first to upload demo videos');
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
        console.error('[Landing] Backend error:', data);
        throw new Error(data.error || 'Failed to send magic link');
      }

      console.log('[Landing] Magic link sent successfully!');
      setLoginSent(true);
    } catch (e: any) {
      console.error('[Landing] OTP Error:', e);
      setLoginError(e.message || 'Network error - please try again');
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
      console.log('[Landing] Resending magic link via backend to:', email);

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
        console.error('[Landing] Resend error:', data);
        throw new Error(data.error || 'Failed to resend magic link');
      }

      console.log('[Landing] Magic link resent successfully!');
      alert('Magic link sent! Check your email and click the login link.');
    } catch (e: any) {
      console.error('[Landing] Resend Error:', e);
      setLoginError(e.message || 'Network error');
    } finally {
      setLoginLoading(false);
    }
  };

  // Add state for OTP code (for future use if needed)
  const [otpCode, setOtpCode] = React.useState('');

  // Render login form when showLogin is true
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
            <h1 className="text-3xl font-bold text-white">AI Cine-Director</h1>
            <p className="text-slate-400 mt-2">{loginSent ? 'Check your email' : 'Sign in to continue'}</p>
          </div>

          {!loginSent ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <p className="text-sm text-slate-400 mb-4">Enter your email to receive a verification code:</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white mb-4"
              />
              {loginError && <p className="text-red-400 text-sm mb-4">{loginError}</p>}
              <button
                onClick={handleSendCode}
                disabled={loginLoading || !email}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold rounded-lg"
              >
                {loginLoading ? 'Sending...' : 'Send Verification Code'}
              </button>
              <p className="text-xs text-slate-500 mt-4 text-center">
                By continuing, you agree to our Terms of Service
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <p className="text-sm text-slate-400 mb-4">{lang === 'zh' ? '输入邮箱收到的验证码:' : 'Enter the verification code from your email:'}</p>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="00000000"
                maxLength={8}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white mb-4 text-center text-xl tracking-[0.5em] font-mono"
              />
              {loginError && <p className="text-red-400 text-sm mb-4">{loginError}</p>}
              <button
                onClick={async () => {
                  if (!otpCode || otpCode.length < 6) {
                    setLoginError(lang === 'zh' ? '请输入8位验证码' : 'Please enter an 8-digit verification code');
                    return;
                  }
                  setLoginLoading(true);
                  setLoginError('');
                  try {
                    // 验证 OTP
                    const { error } = await supabase.auth.verifyOtp({
                      email: email,
                      token: otpCode,
                      type: 'magiclink'
                    });
                    if (error) {
                      // 尝试 email 类型
                      const { error: emailError } = await supabase.auth.verifyOtp({
                        email: email,
                        token: otpCode,
                        type: 'email'
                      });
                      if (emailError) throw emailError;
                    }
                    // 验证成功，页面会自动刷新通过 Auth state change 登录
                  } catch (e: any) {
                    console.error('[Landing] OTP verify error:', e);
                    setLoginError(e.message || (lang === 'zh' ? '验证码无效，请重试' : 'Invalid verification code, please try again'));
                  } finally {
                    setLoginLoading(false);
                  }
                }}
                disabled={loginLoading || otpCode.length < 8}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold rounded-lg"
              >
                {loginLoading ? (lang === 'zh' ? '验证中...' : 'Verifying...') : (lang === 'zh' ? '确认登录' : 'Confirm & Login')}
              </button>
              <button
                onClick={handleResendCode}
                disabled={loginLoading}
                className="w-full py-2 text-indigo-400 text-sm mt-3"
              >
                {loginLoading ? (lang === 'zh' ? '发送中...' : 'Sending...') : (lang === 'zh' ? '重新发送验证码' : 'Resend Code')}
              </button>
              <button
                onClick={resetLoginForm}
                className="w-full py-2 text-slate-500 text-sm"
              >
                ← {lang === 'zh' ? '使用其他邮箱' : 'Use a different email'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-slate-950 to-purple-900/20" />

        <div className="relative max-w-6xl mx-auto px-6 py-20">
          {/* Logo & Badge */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/30">
              <SparklesIcon className="w-8 h-8 text-white" />
            </div>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white text-center mb-6 tracking-tight">
            AI Cine-Director
          </h1>

          <p className="text-xl text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            AI Video Creation Platform - From Script to Cinema with Just One Prompt
          </p>

          {/* CTA Button */}
          <div className="text-center mb-16">
            <div className="flex gap-4 justify-center flex-wrap">
              <button
                onClick={() => { console.log('[Landing] Get Started clicked'); setShowLogin(true); }}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white text-lg font-bold rounded-full transition-all shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transform hover:scale-105"
              >
                🚀 Get Started
              </button>
              <a
                href="mailto:sales@aidirector.business?subject=Enterprise Inquiry"
                className="px-8 py-4 bg-transparent border-2 border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-lg font-bold rounded-full transition-all"
              >
                Contact Sales
              </a>
              {/* Developer upload button */}
              <button
                onClick={() => { console.log('[Landing] Upload clicked'); setShowUpload(true); }}
                className="px-6 py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold rounded-full transition-all shadow-lg shadow-emerald-500/30"
              >
                📤 Upload Demo
              </button>
            </div>
            <p className="text-sm text-slate-500 mt-4">
              No credit card required
            </p>
          </div>

          {/* Demo Video - User's generated video */}
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
              Sample work generated by AI Cine-Director
            </p>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          Why Choose AI Cine-Director?
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Feature 1 */}
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">🎬</div>
            <h3 className="text-xl font-bold text-white mb-2">
              Character Consistency
            </h3>
            <p className="text-slate-400 text-sm">
              Our Visual Anchoring System ensures consistent characters across scenes
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">⚡</div>
            <h3 className="text-xl font-bold text-white mb-2">
              End-to-End Workflow
            </h3>
            <p className="text-slate-400 text-sm">
              From script to video, complete in one platform
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
            <div className="text-3xl mb-4">🎥</div>
            <h3 className="text-xl font-bold text-white mb-2">
              Multi-Model Support
            </h3>
            <p className="text-slate-400 text-sm">
              Support for Runway, Kling, Veo and more AI video models
            </p>
          </div>
        </div>
      </div>

      {/* Pricing Preview */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          B2B Enterprise Pricing
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {BUSINESS_PLANS.map((plan, index) => (
            <div key={plan.id} className={`bg-slate-900/50 p-6 rounded-xl border ${plan.popular ? 'border-indigo-500/50 bg-indigo-900/20' : 'border-slate-800'} text-center relative`}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <h3 className="text-lg font-bold text-white mb-2">{plan.name}</h3>
              <p className="text-3xl font-bold text-indigo-400 mb-4">${plan.priceMonthly}<span className="text-sm text-slate-400">/month</span></p>
              <p className="text-slate-400 text-sm mb-4">{plan.creditsMonthly.toLocaleString()} credits/month</p>
              <ul className="text-xs text-slate-500 mb-4 space-y-1">
                {plan.features.slice(0, 4).map((f, i) => (
                  <li key={i}>✓ {f}</li>
                ))}
              </ul>
              <button
                onClick={() => onOpenPricing?.()}
                className={`w-full py-2 rounded-lg text-sm ${plan.popular ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'} text-white transition-colors`}
              >
                Subscribe Now
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-6 text-center text-slate-500 text-sm">
          <p>© 2026 AI Cine-Director. All rights reserved.</p>
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

            <h3 className="text-xl font-bold text-white mb-4">📤 Upload Demo Video</h3>
            <p className="text-slate-400 text-sm mb-6">
              Upload a video to replace the demo on the landing page. Only developers can upload.
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
                  {uploadProgress || 'Click to select video'}
                </p>
                <p className="text-slate-500 text-xs mt-2">Max 50MB, MP4/WebM</p>
              </label>
            </div>

            {uploadError && (
              <p className="text-red-400 text-sm mb-4 text-center">{uploadError}</p>
            )}

            <button
              onClick={() => { setShowUpload(false); setUploadError(''); setUploadProgress(''); }}
              className="w-full py-2 text-slate-400 hover:text-white text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
