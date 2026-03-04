import React, { useState, useEffect } from 'react';
import { StoryboardProject, Scene, MODEL_COSTS, CREDIT_COSTS, MODEL_MULTIPLIERS, CREDIT_PACKS, BUSINESS_PLANS, API_PLANS, BusinessPlan, APIPlan } from '../types';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon, CheckIcon } from './IconComponents';
import { supabase } from '../lib/supabaseClient';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

const STRIPE_LINKS: any = {
  monthly: { creator: '', director: '' },
  yearly: { creator: '', director: '' }
};

// Toast notification component
const Toast: React.FC<{ message: string; type: 'success' | 'error' | 'info'; onClose: () => void }> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-indigo-600';
  
  return (
    <div className={`fixed bottom-6 right-6 ${bgColor} text-white px-6 py-3 rounded-xl shadow-lg z-[100] flex items-center gap-3 animate-in slide-in-from-bottom-4`}>
      <span>{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">×</button>
    </div>
  );
};

const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, onUpgrade }) => {
  const { buyCredits } = useAppContext();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedTier, setSelectedTier] = useState<'free' | 'creator' | 'director'>('creator');
  const [viewMode, setViewMode] = useState<'subscription' | 'topup' | 'business' | 'api'>('subscription');
  const [selectedBusinessPlan, setSelectedBusinessPlan] = useState<BusinessPlan | null>(null);
  const [selectedApiPlan, setSelectedApiPlan] = useState<APIPlan | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Track processing state per button
  const [processingButton, setProcessingButton] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  };

  if (!isOpen) return null;

  const handleSubscribe = async (tier: 'creator' | 'director') => {
    const btnKey = `subscribe-${tier}`;
    try {
      setProcessingButton(btnKey);
      console.log('[Pricing] Starting subscription for tier:', tier);
      
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[Pricing] Session:', session ? 'found' : 'not found');
      
      if (!session) {
        showToast("请先登录以订阅", 'error');
        console.log('[Pricing] No session - user not logged in');
        setProcessingButton(null);
        return;
      }
      
      const billingCycleSafe = billingCycle;
      const userId = session.user.id;
      const email = session.user.email;
      console.log('[Pricing] User:', email, 'ID:', userId);
      
      showToast('正在跳转到支付页面...', 'info');
      console.log('[Pricing] Calling /api/billing/subscribe...');
      
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tier, billingCycle: billingCycleSafe, userId, email }),
      });
      
      console.log('[Pricing] Response status:', response.status);
      const responseData = await response.json();
      console.log('[Pricing] Response data:', responseData);
      
      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }
      
      const { url } = responseData;
      if (url) {
        console.log('[Pricing] Redirecting to:', url);
        window.location.href = url;
      } else {
        throw new Error('未获取到支付链接');
      }
    } catch (e: any) {
      console.error('[Pricing] Subscribe error:', e);
      showToast(`订阅失败：${e.message}`, 'error');
    } finally {
      setProcessingButton(null);
    }
  };

  const handleTopUp = async (pack: typeof CREDIT_PACKS[0]) => {
    const btnKey = `topup-${pack.id}`;
    try {
      setProcessingButton(btnKey);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast("请先登录以购买额度", 'error');
        setProcessingButton(null);
        return;
      }

      // Use the proper checkout API that creates a Stripe Checkout Session
      // This sends user_id + credits in metadata so the webhook can add credits correctly
      showToast('正在跳转到支付页面...', 'info');
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ packageId: pack.id }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || '创建支付会话失败');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('未获取到支付链接');
      }

    } catch (e: any) {
      console.error(e);
      showToast(`支付失败：${e.message}`, 'error');
      setProcessingButton(null);
    }
  };

  // B2B 企业套餐订阅
  const handleBusinessSubscribe = async (plan: BusinessPlan) => {
    const btnKey = `business-${plan.id}`;
    try {
      setProcessingButton(btnKey);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast("请先登录以订阅企业套餐", 'error');
        setProcessingButton(null);
        return;
      }
      showToast('正在跳转到支付页面...', 'info');
      
      const response = await fetch('/api/billing/business-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          planId: plan.id,
          userId: session.user.id,
          email: session.user.email 
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || '创建企业订阅失败');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('未获取到支付链接');
      }
    } catch (e: any) {
      showToast(`订阅失败：${e.message}`, 'error');
    } finally {
      setProcessingButton(null);
    }
  };

  // API 接入订阅
  const handleApiSubscribe = async (plan: APIPlan) => {
    const btnKey = `api-${plan.id}`;
    try {
      setProcessingButton(btnKey);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast("请先登录以订阅API套餐", 'error');
        setProcessingButton(null);
        return;
      }
      showToast('正在跳转到支付页面...', 'info');
      
      const response = await fetch('/api/billing/api-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          planId: plan.id,
          userId: session.user.id,
          email: session.user.email 
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || '创建API订阅失败');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('未获取到支付链接');
      }
    } catch (e: any) {
      showToast(`订阅失败：${e.message}`, 'error');
    } finally {
      setProcessingButton(null);
    }
  };

  const getCardStyles = (tier: 'free' | 'creator' | 'director') => {
    // ... (keep existing)
    const isSelected = selectedTier === tier;
    return `
      relative rounded-2xl p-8 flex flex-col h-full transition-all duration-300 cursor-pointer
      ${isSelected
        ? 'bg-slate-900 border-2 border-indigo-500 shadow-2xl shadow-indigo-500/20 transform md:-translate-y-2 z-10'
        : 'bg-slate-900/50 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'}
    `;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl p-6 md:p-10 my-8">

        {/* ... (Close Buttons kept same) ... */}
        <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white transition-colors flex items-center gap-2 p-2 hover:bg-slate-900 rounded-lg z-10 text-sm font-medium">返回</button>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-900 rounded-full z-10"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></button>

        <div className="text-center mb-8 mt-6">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            {viewMode === 'subscription' ? '选择您的制作预算' : viewMode === 'topup' ? '充值额度' : viewMode === 'business' ? '企业套餐' : 'API接入'}
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8">
            {viewMode === 'subscription' ? '通过 Stripe 安全支付，为独立创作者提供极具竞争力的价格。' : 
             viewMode === 'topup' ? '按需购买额度包，创作永不停歇。' :
             viewMode === 'business' ? '为企业和工作室打造的专业方案，批量生产更优惠。' :
             '为开发者提供完整的 API 接入服务。'}
          </p>

          {/* VIEW MODE TOGGLE */}
          <div className="flex justify-center gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setViewMode('subscription')}
              className={`px-4 py-2 rounded-full font-bold transition-all text-sm ${viewMode === 'subscription' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'}`}
            >
              个人版
            </button>
            <button
              onClick={() => setViewMode('topup')}
              className={`px-4 py-2 rounded-full font-bold transition-all text-sm ${viewMode === 'topup' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'}`}
            >
              额度包
            </button>
            <button
              onClick={() => setViewMode('business')}
              className={`px-4 py-2 rounded-full font-bold transition-all text-sm ${viewMode === 'business' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black' : 'text-slate-500 hover:text-white'}`}
            >
              企业版 🔥
            </button>
            <button
              onClick={() => setViewMode('api')}
              className={`px-4 py-2 rounded-full font-bold transition-all text-sm ${viewMode === 'api' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-black' : 'text-slate-500 hover:text-white'}`}
            >
              API接入
            </button>
          </div>

          {/* BILLING CYCLE TOGGLE (Only for Subscription) */}
          {viewMode === 'subscription' && (
            <div className="relative inline-flex bg-slate-900 p-1 rounded-xl border border-slate-800">
              <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-indigo-600 rounded-lg shadow-sm transition-all duration-300 ease-out ${billingCycle === 'monthly' ? 'left-1' : 'left-[calc(50%+0px)]'}`} />
              <button onClick={() => setBillingCycle('monthly')} className={`relative z-10 px-8 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>月付</button>
              <button onClick={() => setBillingCycle('yearly')} className={`relative z-10 px-8 py-2 text-sm font-medium rounded-lg transition-colors duration-200 flex items-center gap-2 ${billingCycle === 'yearly' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                年付 <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">免费享 2 个月</span>
              </button>
            </div>
          )}
        </div>

        {/* SUBSCRIPTION VIEW */}
        {viewMode === 'subscription' && (
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {/* TIER 1: FREE */}
            <div onClick={() => setSelectedTier('free')} className={getCardStyles('free')}>
              <div className="mb-4"><h3 className="text-xl font-semibold text-slate-200">免费试用</h3><p className="text-slate-500 text-sm mt-1">适合爱好者和测试用户</p></div>
              <div className="mb-6"><span className="text-4xl font-bold text-white">$0</span><span className="text-slate-500">/月</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text="50 额度 / 月" />
                <Feature text="标准速度" />
              </ul>
              <button disabled className="w-full py-3 rounded-xl bg-slate-800 text-slate-500 font-semibold cursor-not-allowed border border-slate-700/50">当前方案</button>
            </div>

            {/* TIER 2: CREATOR */}
            <div onClick={() => setSelectedTier('creator')} className={getCardStyles('creator')}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-1 rounded-full text-xs font-bold tracking-wide shadow-lg whitespace-nowrap z-20">最佳性价比 🔥</div>
              <div className="mb-4"><h3 className="text-xl font-semibold text-white">创作者</h3><p className="text-indigo-200/60 text-sm mt-1">市场破格优惠</p></div>
              <div className="mb-6 flex flex-col">
                <div className="flex items-baseline gap-1"><span className="text-5xl font-bold text-white">{billingCycle === 'monthly' ? '$9.90' : '$8.25'}</span><span className="text-slate-400">/月</span></div>
                {billingCycle === 'yearly' && <span className="text-xs text-indigo-300 mt-1">年付 $99</span>}
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text={billingCycle === 'yearly' ? "16,000 额度 / 年" : "1,000 额度 / 月"} highlight={selectedTier === 'creator'} />
                <Feature text={billingCycle === 'yearly' ? "约 88 个高端 Wan 2.1 视频/年" : "约 66 个高端 Wan 2.1 视频/月"} />
                <Feature text="商用授权" />
              </ul>
              <button 
                onClick={(e) => { e.stopPropagation(); handleSubscribe('creator'); }} 
                disabled={processingButton === 'subscribe-creator'}
                className="w-full py-3 rounded-xl font-bold transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingButton === 'subscribe-creator' ? <LoaderIcon className="w-4 h-4 animate-spin" /> : null}
                {processingButton === 'subscribe-creator' ? '处理中...' : '通过 Stripe 订阅'}
              </button>
            </div>

            {/* TIER 3: DIRECTOR */}
            <div onClick={() => setSelectedTier('director')} className={getCardStyles('director')}>
              <div className="mb-4"><h3 className="text-xl font-semibold text-slate-200">导演</h3><p className="text-slate-500 text-sm mt-1">高级用户和工作室</p></div>
              <div className="mb-6 flex flex-col">
                <div className="flex items-baseline gap-1"><span className="text-4xl font-bold text-white">{billingCycle === 'monthly' ? '$29.90' : '$24.91'}</span><span className="text-slate-500">/月</span></div>
                {billingCycle === 'yearly' && <span className="text-xs text-green-400 mt-1">年付 $299</span>}
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text={billingCycle === 'yearly' ? "50,000 额度 / 年" : "3,500 额度 / 月"} />
                <Feature text={billingCycle === 'yearly' ? "约 277 个高端视频/年" : "约 230 个高端视频/月"} />
                <Feature text="最高优先速度" />
              </ul>
              <button 
                onClick={(e) => { e.stopPropagation(); handleSubscribe('director'); }} 
                disabled={processingButton === 'subscribe-director'}
                className="w-full py-3 rounded-xl font-semibold transition-colors border border-slate-600 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processingButton === 'subscribe-director' ? <LoaderIcon className="w-4 h-4 animate-spin" /> : null}
                {processingButton === 'subscribe-director' ? '处理中...' : '通过 Stripe 订阅'}
              </button>
            </div>
          </div>
        )}

        {/* TOP UP VIEW */}
        {viewMode === 'topup' && (
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack.id} className="relative rounded-2xl p-8 flex flex-col h-full bg-slate-900 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-900/80 transition-all group">
                {pack.popular && (
                  <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">热门</div>
                )}
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white">{pack.label}</h3>
                  <div className="text-emerald-400 font-mono text-3xl font-bold mt-2">+{pack.credits} <span className="text-sm text-slate-500 font-sans font-normal">额度</span></div>
                </div>
                <div className="mb-8 border-t border-slate-800 pt-4 flex-1">
                  <div className="flex justify-between text-sm mb-2 text-slate-400">
                    <span>价格</span>
                    <span className="text-white font-bold">${pack.price}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>每千额度成本</span>
                    <span>${(pack.price / (pack.credits / 1000)).toFixed(2)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleTopUp(pack)}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-lg bg-white hover:bg-emerald-400 hover:text-black text-black font-bold transition-all flex items-center justify-center gap-2"
                >
                  {processingButton === `topup-${pack.id}` ? <LoaderIcon className="w-4 h-4 animate-spin" /> : null}
                  {processingButton === `topup-${pack.id}` ? '处理中...' : '立即购买'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* BUSINESS PLAN VIEW */}
        {viewMode === 'business' && (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
            {BUSINESS_PLANS.map((plan) => (
              <div 
                key={plan.id} 
                className={`relative rounded-2xl p-6 flex flex-col h-full transition-all duration-300 cursor-pointer
                  ${plan.popular 
                    ? 'bg-gradient-to-b from-amber-500/20 to-slate-900 border-2 border-amber-500/50 shadow-lg shadow-amber-500/20' 
                    : 'bg-slate-900 border border-slate-700 hover:border-amber-500/30'}`}
              >
                {plan.popular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold px-4 py-1 rounded-full">
                    最受欢迎
                  </div>
                )}
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <p className="text-amber-400/60 text-xs mt-1">{plan.nameZh}</p>
                </div>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-white">${plan.priceMonthly}</span>
                  <span className="text-slate-500">/月</span>
                </div>
                <div className="mb-6 text-sm">
                  <div className="flex justify-between text-slate-400 mb-2">
                    <span>月度积分</span>
                    <span className="text-white font-bold">{plan.creditsMonthly.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>单积分成本</span>
                    <span className="text-emerald-400 font-mono">${plan.pricePerCredit.toFixed(3)}</span>
                  </div>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <CheckIcon className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleBusinessSubscribe(plan)}
                  disabled={processingButton === `business-${plan.id}`}
                  className={`w-full py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2
                    ${plan.popular 
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black' 
                      : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-600'} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {processingButton === `business-${plan.id}` ? <LoaderIcon className="w-4 h-4 animate-spin" /> : null}
                  {processingButton === `business-${plan.id}` ? '处理中...' : '立即订阅'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* API PLAN VIEW */}
        {viewMode === 'api' && (
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {API_PLANS.map((plan) => (
              <div key={plan.id} className="relative rounded-2xl p-8 flex flex-col h-full bg-slate-900 border border-slate-700 hover:border-blue-500/50 hover:bg-slate-900/80 transition-all group">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                  <p className="text-blue-400/60 text-sm mt-1">{plan.nameZh}</p>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">${plan.priceMonthly}</span>
                  <span className="text-slate-500">/月</span>
                </div>
                <div className="mb-6 border-t border-slate-800 pt-4">
                  <div className="flex justify-between text-sm mb-2 text-slate-400">
                    <span>API调用量</span>
                    <span className="text-white font-bold">{plan.apiCallsMonthly.toLocaleString()}/月</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>超额费用</span>
                    <span className="text-blue-400 font-mono">${plan.overageRate}/次</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3 text-sm text-slate-300">
                      <CheckIcon className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleApiSubscribe(plan)}
                  disabled={processingButton === `api-${plan.id}`}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processingButton === `api-${plan.id}` ? <LoaderIcon className="w-4 h-4 animate-spin" /> : null}
                  {processingButton === `api-${plan.id}` ? '处理中...' : '申请接入'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer Link & Text */}
        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs">由 <strong>Stripe</strong> 提供安全支付，256 位 SSL 加密。</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm transition-colors hover:underline cursor-pointer">
            先不了，返回工作室
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
};

const Feature: React.FC<{ text: string; highlight?: boolean }> = ({ text, highlight }) => (
  <li className="flex items-start gap-3">
    <div className={`mt-0.5 rounded-full p-0.5 shrink-0 ${highlight ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
      <CheckIcon className="w-4 h-4" />
    </div>
    <span className={`text-sm ${highlight ? 'text-white font-medium' : 'text-slate-300'}`}>{text}</span>
  </li>
);

export default PricingModal;
