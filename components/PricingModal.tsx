import React, { useState } from 'react';
import { StoryboardProject, Scene, MODEL_COSTS, CREDIT_COSTS, MODEL_MULTIPLIERS, CREDIT_PACKS } from '../types';
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

const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, onUpgrade }) => {
  const { buyCredits } = useAppContext();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedTier, setSelectedTier] = useState<'free' | 'creator' | 'director'>('creator');
  const [viewMode, setViewMode] = useState<'subscription' | 'topup'>('subscription');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleSubscribe = (tier: 'creator' | 'director') => {
    // Placeholder for subscription logic
    alert("Subscriptions are currently invite-only. Please use Credit Packs.");
  };

  const handleTopUp = async (pack: typeof CREDIT_PACKS[0]) => {
    try {
      setIsProcessing(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert("Please sign in to purchase credits.");
        setIsProcessing(false);
        return;
      }

      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ packageId: pack.id })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Checkout failed");
      }

      const { url } = await res.json();
      if (url) window.location.href = url;

    } catch (e: any) {
      console.error(e);
      alert(`Checkout failed: ${e.message}`);
      setIsProcessing(false);
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
        <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white transition-colors flex items-center gap-2 p-2 hover:bg-slate-900 rounded-lg z-10 text-sm font-medium">Back</button>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-900 rounded-full z-10"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></button>

        <div className="text-center mb-8 mt-6">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            {viewMode === 'subscription' ? 'Choose Your Production Budget' : 'Top Up Credits'}
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8">
            {viewMode === 'subscription' ? 'Secure payment via Stripe. Disruptive pricing for independent creators.' : 'Pay-as-you-go packs. Never stop creating.'}
          </p>

          {/* VIEW MODE TOGGLE */}
          <div className="flex justify-center gap-4 mb-6">
            <button
              onClick={() => setViewMode('subscription')}
              className={`px-6 py-2 rounded-full font-bold transition-all ${viewMode === 'subscription' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'}`}
            >
              Monthly Plans
            </button>
            <button
              onClick={() => setViewMode('topup')}
              className={`px-6 py-2 rounded-full font-bold transition-all ${viewMode === 'topup' ? 'bg-white text-black' : 'text-slate-500 hover:text-white'}`}
            >
              Credit Packs
            </button>
          </div>

          {/* BILLING CYCLE TOGGLE (Only for Subscription) */}
          {viewMode === 'subscription' && (
            <div className="relative inline-flex bg-slate-900 p-1 rounded-xl border border-slate-800">
              <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-indigo-600 rounded-lg shadow-sm transition-all duration-300 ease-out ${billingCycle === 'monthly' ? 'left-1' : 'left-[calc(50%+0px)]'}`} />
              <button onClick={() => setBillingCycle('monthly')} className={`relative z-10 px-8 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>Monthly</button>
              <button onClick={() => setBillingCycle('yearly')} className={`relative z-10 px-8 py-2 text-sm font-medium rounded-lg transition-colors duration-200 flex items-center gap-2 ${billingCycle === 'yearly' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                Yearly <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">Free 2 Months</span>
              </button>
            </div>
          )}
        </div>

        {/* SUBSCRIPTION VIEW */}
        {viewMode === 'subscription' && (
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {/* TIER 1: FREE */}
            <div onClick={() => setSelectedTier('free')} className={getCardStyles('free')}>
              <div className="mb-4"><h3 className="text-xl font-semibold text-slate-200">Free Trial</h3><p className="text-slate-500 text-sm mt-1">For hobbyists & testing</p></div>
              <div className="mb-6"><span className="text-4xl font-bold text-white">$0</span><span className="text-slate-500">/mo</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text="50 Credits / month" />
                <Feature text="Standard Speed" />
              </ul>
              <button disabled className="w-full py-3 rounded-xl bg-slate-800 text-slate-500 font-semibold cursor-not-allowed border border-slate-700/50">Current Plan</button>
            </div>

            {/* TIER 2: CREATOR */}
            <div onClick={() => setSelectedTier('creator')} className={getCardStyles('creator')}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-1 rounded-full text-xs font-bold tracking-wide shadow-lg whitespace-nowrap z-20">BEST VALUE 🔥</div>
              <div className="mb-4"><h3 className="text-xl font-semibold text-white">Creator</h3><p className="text-indigo-200/60 text-sm mt-1">Market disruptor deal</p></div>
              <div className="mb-6 flex flex-col">
                <div className="flex items-baseline gap-1"><span className="text-5xl font-bold text-white">{billingCycle === 'monthly' ? '$9.90' : '$8.25'}</span><span className="text-slate-400">/mo</span></div>
                {billingCycle === 'yearly' && <span className="text-xs text-indigo-300 mt-1">Billed $99 yearly</span>}
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text={billingCycle === 'yearly' ? "12,000 Credits / year" : "1,000 Credits / month"} highlight={selectedTier === 'creator'} />
                <Feature text="~66 High-End Wan 2.1 Videos/mo" />
                <Feature text="Commercial License" />
              </ul>
              <button onClick={(e) => { e.stopPropagation(); handleSubscribe('creator'); }} className="w-full py-3 rounded-xl font-bold transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-500/25">Subscribe via Stripe</button>
            </div>

            {/* TIER 3: DIRECTOR */}
            <div onClick={() => setSelectedTier('director')} className={getCardStyles('director')}>
              <div className="mb-4"><h3 className="text-xl font-semibold text-slate-200">Director</h3><p className="text-slate-500 text-sm mt-1">Power users & studios</p></div>
              <div className="mb-6 flex flex-col">
                <div className="flex items-baseline gap-1"><span className="text-4xl font-bold text-white">{billingCycle === 'monthly' ? '$29.90' : '$24.91'}</span><span className="text-slate-500">/mo</span></div>
                {billingCycle === 'yearly' && <span className="text-xs text-green-400 mt-1">Billed $299 yearly</span>}
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <Feature text={billingCycle === 'yearly' ? "42,000 Credits / year" : "3,500 Credits / month"} />
                <Feature text="~230 High-End Videos/mo" />
                <Feature text="Highest Priority Speed" />
              </ul>
              <button onClick={(e) => { e.stopPropagation(); handleSubscribe('director'); }} className="w-full py-3 rounded-xl font-semibold transition-colors border border-slate-600 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white hover:border-slate-500">Subscribe via Stripe</button>
            </div>
          </div>
        )}

        {/* TOP UP VIEW */}
        {viewMode === 'topup' && (
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack.id} className="relative rounded-2xl p-8 flex flex-col h-full bg-slate-900 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-900/80 transition-all group">
                {pack.popular && (
                  <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">POPULAR</div>
                )}
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white">{pack.label}</h3>
                  <div className="text-emerald-400 font-mono text-3xl font-bold mt-2">+{pack.credits} <span className="text-sm text-slate-500 font-sans font-normal">credits</span></div>
                </div>
                <div className="mb-8 border-t border-slate-800 pt-4 flex-1">
                  <div className="flex justify-between text-sm mb-2 text-slate-400">
                    <span>Price</span>
                    <span className="text-white font-bold">${pack.price}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Cost per 1k</span>
                    <span>${(pack.price / (pack.credits / 1000)).toFixed(2)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleTopUp(pack)}
                  disabled={isProcessing}
                  className="w-full py-3 rounded-lg bg-white hover:bg-emerald-400 hover:text-black text-black font-bold transition-all flex items-center justify-center gap-2"
                >
                  {isProcessing ? <LoaderIcon className="w-4 h-4 animate-spin" /> : 'Buy Now'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer Link & Text */}
        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs">Powered by <strong>Stripe</strong>. Secure 256-bit SSL Encrypted Payment.</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm transition-colors hover:underline cursor-pointer">
            Maybe Later, Back to Studio
          </button>
        </div>
      </div>
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
