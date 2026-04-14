import React, { useState, useEffect } from 'react';
import { StoryboardProject, Scene, MODEL_COSTS, CREDIT_COSTS, MODEL_MULTIPLIERS, CREDIT_PACKS, BUSINESS_PLANS, API_PLANS, BusinessPlan, APIPlan } from '../types';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon, CheckIcon } from './IconComponents';
import { supabase } from '../lib/supabaseClient';
import { t } from '../i18n';

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
  const { buyCredits, settings } = useAppContext();
  const lang = settings.lang;
  const isZh = lang === 'zh';
  
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedTier, setSelectedTier] = useState<'free' | 'creator' | 'director'>('creator');
  const [viewMode, setViewMode] = useState<'subscription' | 'topup' | 'business' | 'api'>('subscription');
  const [selectedBusinessPlan, setSelectedBusinessPlan] = useState<BusinessPlan | null>(null);
  const [selectedApiPlan, setSelectedApiPlan] = useState<APIPlan | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [processingButton, setProcessingButton] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  };

  if (!isOpen) return null;

  const handleSubscribe = async (tier: 'creator' | 'director') => {
    const btnKey = `subscribe-${tier}`;
    try {
      setProcessingButton(btnKey);
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        showToast(t(lang, 'loginToSubscribe'), 'error');
        setProcessingButton(null);
        return;
      }
      
      const userId = session.user.id;
      const email = session.user.email;
      
      showToast(t(lang, 'redirecting'), 'info');
      
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tier, billingCycle, userId, email }),
      });
      
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}`);
      }
      
      const { url } = responseData;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error(isZh ? '未获取到支付链接' : 'Payment link unavailable');
      }
    } catch (e: any) {
      console.error('[Pricing] Subscribe error:', e);
      showToast(`${t(lang, 'paymentFailed')}: ${e.message}`, 'error');
    } finally {
      setProcessingButton(null);
    }
  };

  const handleBuyCredits = async (packId: string) => {
    const btnKey = `buy-${packId}`;
    try {
      setProcessingButton(btnKey);
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        showToast(t(lang, 'loginToBuy'), 'error');
        return;
      }

      showToast(t(lang, 'redirecting'), 'info');
      
      const response = await fetch('/api/billing/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ packId }),
      });
      
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error || 'Request failed');
      
      if (responseData.url) {
        window.location.href = responseData.url;
      }
    } catch (e: any) {
      showToast(`${t(lang, 'paymentFailed')}: ${e.message}`, 'error');
    } finally {
      setProcessingButton(null);
    }
  };

  const currentTabClass = (mode: typeof viewMode) => 
    `px-6 py-2 rounded-lg font-medium transition-all ${viewMode === mode ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-8 pb-4 flex justify-between items-start">
          <div>
            <h2 className="text-3xl font-extrabold text-white mb-2">{t(lang, 'chooseBudget')}</h2>
            <p className="text-slate-400">{t(lang, 'pciSecure')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* View Switcher */}
        <div className="px-8 mb-8 flex flex-wrap gap-2">
          <button onClick={() => setViewMode('subscription')} className={currentTabClass('subscription')}>
            {t(lang, 'subscription')}
          </button>
          <button onClick={() => setViewMode('topup')} className={currentTabClass('topup')}>
            {t(lang, 'topup')}
          </button>
          <button onClick={() => setViewMode('business')} className={currentTabClass('business')}>
            {t(lang, 'business')}
          </button>
          <button onClick={() => setViewMode('api')} className={currentTabClass('api')}>
            {t(lang, 'api')}
          </button>
        </div>

        <div className="p-8 pt-0">
          {viewMode === 'subscription' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Billing Cycle Toggle */}
              <div className="flex justify-center items-center gap-4 mb-4">
                <span className={`text-sm ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-500'}`}>{t(lang, 'monthly')}</span>
                <button 
                  onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
                  className="w-14 h-8 bg-slate-800 rounded-full p-1 relative transition-colors"
                >
                  <div className={`w-6 h-6 bg-indigo-500 rounded-full transition-all ${billingCycle === 'yearly' ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
                <span className={`text-sm ${billingCycle === 'yearly' ? 'text-white' : 'text-slate-500'}`}>
                  {t(lang, 'yearly')} <span className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded text-xs ml-1">{t(lang, 'save20')}</span>
                </span>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {/* 1. Free Tier */}
                <div className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 flex flex-col hover:border-slate-700 transition-colors">
                  <h3 className="text-xl font-bold text-white mb-2">{t(lang, 'freeTrial')}</h3>
                  <p className="text-slate-500 text-sm mb-6">Explore the features</p>
                  <div className="text-3xl font-bold text-white mb-6">$0<span className="text-sm text-slate-500 font-normal">/forever</span></div>
                  <ul className="space-y-3 mb-8 flex-grow">
                    {[isZh ? '50 初始积分' : '50 initial credits', isZh ? '标准生成模式' : 'Standard generation', '720p output'].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                        <CheckIcon className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={onClose} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-colors">
                    {t(lang, 'currentPlan')}
                  </button>
                </div>

                {/* 2. Creator Tier */}
                <div className="bg-indigo-900/10 rounded-2xl p-6 border border-indigo-500/30 flex flex-col relative transform hover:scale-[1.02] transition-all">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wider uppercase">
                    {t(lang, 'mostPopular')}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '个人版' : 'Creator'}</h3>
                  <p className="text-slate-400 text-sm mb-6">{t(lang, 'creatorDesc')}</p>
                  <div className="text-3xl font-bold text-white mb-6">
                    ${billingCycle === 'monthly' ? '29' : '24'}
                    <span className="text-sm text-slate-500 font-normal">{billingCycle === 'monthly' ? t(lang, 'perMonth') : t(lang, 'perYear')}</span>
                  </div>
                  <ul className="space-y-3 mb-8 flex-grow">
                    {[
                      isZh ? '1,000 每月积分' : '1,000 monthly credits',
                      isZh ? '快速成片管线' : 'Fast pipeline access',
                      isZh ? '去除水印' : 'No watermarks',
                      isZh ? '1080p 高清输出' : '1080p HD output'
                    ].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <CheckIcon className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button 
                    disabled={processingButton === 'subscribe-creator'}
                    onClick={() => handleSubscribe('creator')}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {processingButton === 'subscribe-creator' ? <LoaderIcon className="w-5 h-5 animate-spin"/> : t(lang, 'subscribe')}
                  </button>
                </div>

                {/* 3. Director Tier */}
                <div className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 flex flex-col hover:border-slate-700 transition-colors">
                  <h3 className="text-xl font-bold text-white mb-2">{isZh ? '导演版' : 'Director'}</h3>
                  <p className="text-slate-500 text-sm mb-6">{t(lang, 'directorDesc')}</p>
                  <div className="text-3xl font-bold text-white mb-6">
                    ${billingCycle === 'monthly' ? '99' : '79'}
                    <span className="text-sm text-slate-500 font-normal">{billingCycle === 'monthly' ? t(lang, 'perMonth') : t(lang, 'perYear')}</span>
                  </div>
                  <ul className="space-y-3 mb-8 flex-grow">
                    {[
                      isZh ? '4,000 每月积分' : '4,000 monthly credits',
                      isZh ? '4K 蓝光输出' : '4K ultra-wide output',
                      isZh ? '角色一致性锚点' : 'Character consistency anchor',
                      isZh ? '完全商用协议' : 'Full commercial rights'
                    ].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                        <CheckIcon className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button 
                    disabled={processingButton === 'subscribe-director'}
                    onClick={() => handleSubscribe('director')}
                    className="w-full py-3 bg-white hover:bg-slate-100 text-slate-900 rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                  >
                    {processingButton === 'subscribe-director' ? <LoaderIcon className="w-5 h-5 animate-spin"/> : t(lang, 'upgrade')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'topup' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">{t(lang, 'topupTitle')}</h3>
                <p className="text-slate-400">{t(lang, 'topupDesc')}</p>
              </div>
              <div className="grid md:grid-cols-3 gap-6">
                {CREDIT_PACKS.map(pack => (
                  <div key={pack.id} className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 hover:border-indigo-500/30 transition-all group">
                    <div className="text-indigo-400 font-bold mb-1">{pack.credits.toLocaleString()} {t(lang, 'credits')}</div>
                    <div className="text-2xl font-bold text-white mb-6">${pack.price}</div>
                    <button 
                      disabled={processingButton === `buy-${pack.id}`}
                      onClick={() => handleBuyCredits(pack.id)}
                      className="w-full py-2 bg-slate-800 group-hover:bg-indigo-600 text-white rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2"
                    >
                      {processingButton === `buy-${pack.id}` ? <LoaderIcon className="w-4 h-4 animate-spin"/> : t(lang, 'buyNow')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === 'business' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">{t(lang, 'businessDesc')}</h3>
              </div>
              <div className="grid md:grid-cols-1 gap-4">
                {BUSINESS_PLANS.map(plan => (
                  <div key={plan.id} className="bg-slate-950/50 rounded-2xl p-8 border border-slate-800 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="text-center md:text-left">
                      <h4 className="text-xl font-bold text-white">{isZh ? plan.nameZh : plan.name}</h4>
                      <p className="text-indigo-400 font-medium">${plan.priceMonthly}{t(lang, 'perMonth')}</p>
                    </div>
                    <div className="flex-grow">
                      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                        {(isZh ? plan.features : (plan.featuresEn ?? plan.features)).map((f, i) => (
                          <li key={i}>✓ {f}</li>
                        ))}
                      </ul>
                    </div>
                    <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all whitespace-nowrap">
                      {t(lang, 'ctaContactSales')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === 'api' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 group">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-bold text-white mb-2">{t(lang, 'apiDesc')}</h3>
              </div>
              <div className="grid md:grid-cols-3 gap-6">
                {API_PLANS.map(plan => (
                  <div key={plan.id} className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 hover:border-indigo-500/50 transition-all flex flex-col">
                    <h4 className="text-lg font-bold text-white mb-1">{isZh ? plan.nameZh : plan.name}</h4>
                    <div className="text-2xl font-bold text-indigo-400 mb-6">${plan.priceMonthly}<span className="text-xs text-slate-500 font-normal">{t(lang, 'perMonth')}</span></div>
                    <ul className="space-y-2 mb-8 flex-grow">
                      {(isZh ? plan.features : (plan.featuresEn ?? plan.features)).map((f, i) => (
                        <li key={i} className="text-xs text-slate-400 flex items-center gap-2">
                          <div className="w-1 h-1 bg-indigo-500 rounded-full" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button className="w-full py-2 bg-slate-800 hover:bg-white hover:text-slate-900 text-white rounded-lg text-sm font-bold transition-all">
                      {isZh ? '申请接入' : 'Apply Access'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-8 pt-0 flex flex-col md:flex-row justify-between items-center text-slate-500 text-xs border-t border-slate-800 mt-4">
          <div className="flex gap-4 mb-4 md:mb-0">
            <span className="flex items-center gap-1"><CheckIcon className="w-3 h-3 text-emerald-500"/> {t(lang, 'paymentSecure')}</span>
            <span className="opacity-50">|</span>
            <span>PCI DSS Compliant</span>
          </div>
          <div className="flex gap-6">
            <button onClick={onClose} className="hover:text-white transition-colors">{t(lang, 'notNow')}</button>
            <button onClick={onClose} className="text-white hover:underline">{t(lang, 'backToStudio')}</button>
          </div>
        </div>
      </div>

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
};

export default PricingModal;
