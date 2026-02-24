import React from 'react';
import { SettingsIcon, SparklesIcon } from './IconComponents';
import { Language, UserCreditState, PLAN_LIMITS } from '../types';
import { t } from '../i18n';
import { useAppContext } from '../context/AppContext';

declare global {
  interface Window {
    aistudio?: {
      openSelectKey: () => Promise<void>;
    };
  }
}

interface HeaderProps {
  lang: Language;
  toggleLang: () => void;
  onOpenSettings: () => void;
  userState: UserCreditState;
  onUpgrade: () => void;
  onLogout: () => void;
}

// ★ GOD MODE Badge Component
const GodModeBadge: React.FC = () => {
  const { entitlement } = useAppContext();
  
  if (!entitlement.isDeveloper && entitlement.mode !== 'developer') {
    return null;
  }
  
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 rounded border border-amber-500/40 animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
      GOD MODE
    </span>
  );
};

const Header: React.FC<HeaderProps> = ({ lang, toggleLang, onOpenSettings, userState, onUpgrade, onLogout }) => {
  const { entitlement } = useAppContext();
  
  const handleOpenKeySelector = async () => {
    if (typeof window !== 'undefined' && window.aistudio) {
      await window.aistudio.openSelectKey();
    }
  };

  // Calculate Usage Percentage for Pro Users
  const activeLimit = userState.planType ? PLAN_LIMITS[userState.planType] : 0;
  const usagePercent = activeLimit > 0 ? Math.min(100, Math.round((userState.monthlyUsage / activeLimit) * 100)) : 0;

  // Color logic for usage bar
  const usageColor = usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-amber-500' : 'bg-indigo-500';

  return (
    <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30">
          <SparklesIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            AI Cine-Director 
            <GodModeBadge />
            {userState.isAdmin && !entitlement.isDeveloper && <span className="text-xs align-top bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded ml-1 border border-emerald-500/30">Dev</span>}
            <span className="text-xs align-top bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded ml-1 border border-indigo-500/30">Pro</span>
          </h1>
          <p className="text-xs text-slate-400">SaaS Edition v3.1</p>
        </div>
      </div>

      {/* Right: Controls & Navigation */}
      <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-xl border border-slate-800 backdrop-blur-sm">

        {/* Monthly Usage Bar (Pro Users Only) */}
        {userState.isPro && activeLimit > 0 && (
          <div className="hidden md:flex flex-col gap-1 mr-2 px-2 min-w-[100px]">
            <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Monthly Usage</span>
              <span className={usagePercent > 90 ? 'text-red-400' : 'text-slate-400'}>{usagePercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${usageColor} transition-all duration-500`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Only show paid key selection if Admin Mode is on */}
        {userState.isAdmin && (
          <button
            onClick={handleOpenKeySelector}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 rounded-lg border border-indigo-500/30 flex items-center gap-2 transition-all ml-1 mr-1"
          >
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Select Paid Key
          </button>
        )}

        {/* Credit Badge - Visible to ALL users (shows 50 by default) */}
        <button
          onClick={onUpgrade}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all group cursor-pointer mr-1
            ${userState.isAdmin
              ? 'bg-slate-950 border-amber-500/50 shadow-lg shadow-amber-500/20'
              : 'bg-slate-800 border-slate-700 hover:border-indigo-500/50'}
          `}
          title={userState.isAdmin ? "Admin Mode Active" : "Click to Upgrade"}
        >
          <span className="text-lg">{userState.isAdmin ? '👑' : '💎'}</span>
          <div className="flex flex-col leading-none items-start">
            <div className="flex items-center gap-1">
              <span className={`font-bold ${userState.balance <= 0 && !userState.isAdmin ? 'text-red-400' : 'text-white'}`}>{userState.balance}</span>
              {userState.isAdmin && (
                <span className="text-[9px] bg-amber-500 text-black font-bold px-1 rounded ml-1">ADMIN</span>
              )}
            </div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider group-hover:text-indigo-400 transition-colors">Credits</span>
          </div>
        </button>

        <div className="w-px h-6 bg-slate-700 mx-1" />

        {/* Language Toggle */}
        <button
          onClick={toggleLang}
          className="px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 font-medium text-sm transition-colors"
        >
          {lang === 'en' ? 'EN' : '中文'}
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          title={t(lang, 'settings')}
        >
          <SettingsIcon className="w-5 h-5" />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 text-xs font-bold transition-colors"
          title="Logout"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default Header;
