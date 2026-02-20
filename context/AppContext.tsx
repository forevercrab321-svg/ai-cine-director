
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { UserCreditState, Language, ImageModel, VideoModel, VideoStyle, AspectRatio, VideoQuality, VideoDuration, VideoFps, VideoResolution, MODEL_COSTS } from '../types';

interface UserProfile {
  id: string;
  name: string;
  role: string;
}

interface AppSettings {
  lang: Language;
  imageModel: ImageModel;
  videoModel: VideoModel;
  videoStyle: VideoStyle;
  aspectRatio: AspectRatio;
  videoQuality: VideoQuality;
  videoDuration: VideoDuration;
  videoFps: VideoFps;
  videoResolution: VideoResolution;
  generationMode: 'storyboard' | 'story';

  // Backend Configuration
  useMockMode: boolean; // Keep for fallback or dev
  backendUrl: string;
}

interface AppContextType {
  userState: UserCreditState;
  isAuthenticated: boolean;
  profile: UserProfile | null;
  settings: AppSettings;

  // Actions
  login: (bypass?: boolean) => void; // Triggered after successful auth
  completeProfile: (name: string, role: string) => Promise<void>;
  logout: () => Promise<void>;
  toggleLang: () => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  deductCredits: (amount: number, details?: { model: string, base: number, mult: number }) => Promise<boolean>;
  upgradeUser: (tier: 'creator' | 'director') => Promise<void>;
  buyCredits: (amount: number, cost: number) => Promise<void>;
  enableGodMode: () => void;

  // UI Control
  isPricingOpen: boolean;
  openPricingModal: () => void;
  closePricingModal: () => void;

  // ★ NEW: Credit guard helpers
  hasEnoughCredits: (amount: number) => boolean;
}

const DEFAULT_CREDITS = 50;

const defaultSettings: AppSettings = {
  lang: 'en',
  imageModel: 'flux',
  videoModel: 'hailuo_02_fast',
  videoStyle: 'pop_mart',
  aspectRatio: '16:9',
  videoQuality: 'standard',
  videoDuration: 6,
  videoFps: 12,
  videoResolution: '720p',
  generationMode: 'storyboard',

  useMockMode: false,
  backendUrl: ''
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [userState, setUserState] = useState<UserCreditState>({
    balance: 0,
    isPro: false,
    isAdmin: false,
    monthlyUsage: 0,
    planType: 'creator'
  });

  // ★ CRITICAL: Real-time balance ref for atomic credit checks
  // React state is stale in closures — this ref is the ONLY source of truth
  // for synchronous balance checking in deductCredits
  const balanceRef = useRef(0);

  // Track if we've already auto-shown paywall this session
  const hasAutoShownPaywall = useRef(false);

  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const toggleLang = () => {
    setSettings(prev => ({ ...prev, lang: prev.lang === 'en' ? 'zh' : 'en' }));
  };

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        return;
      }

      if (data) {
        setProfile({ id: data.id, name: data.name, role: data.role });
        const newBalance = data.credits ?? 0;

        // Restore God Mode from LocalStorage if active
        const isGodMode = localStorage.getItem('ai_cine_god_mode') === 'true';

        if (isGodMode || data.is_admin) {
          balanceRef.current = 999999;
          setUserState({
            balance: 999999,
            isPro: true,
            isAdmin: true,
            monthlyUsage: 0,
            planType: 'director'
          });
        } else {
          balanceRef.current = newBalance; // ★ Sync ref immediately
          setUserState({
            balance: newBalance,
            isPro: data.is_pro,
            isAdmin: data.is_admin,
            monthlyUsage: data.monthly_credits_used || 0,
            planType: data.plan_type || 'creator'
          });
          // ★ AUTO-PAYWALL: If credits <= 0 and not admin, show pricing modal
          if (newBalance <= 0 && !hasAutoShownPaywall.current) {
            hasAutoShownPaywall.current = true;
            // Small delay to let UI render first
            setTimeout(() => {
              setIsPricingOpen(true);
              console.log('[CREDIT GUARD] Auto-opened paywall: balance =', newBalance);
            }, 500);
          }
        }
      }
    } catch (error) {
      console.error('Error in fetchProfile:', error);
    }
  };

  // ★ Supabase Auth State Listener
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        setIsAuthenticated(true);
        fetchProfile(currentSession.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        setIsAuthenticated(true);
        fetchProfile(newSession.user.id);
      } else {
        setIsAuthenticated(false);
        setProfile(null);
        balanceRef.current = 0;
        setUserState({ balance: 0, isPro: false, isAdmin: false, monthlyUsage: 0, planType: 'creator' });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = () => {
    // Standard login trigger - session listener handles the actual state update
  };

  const logout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('ai_cine_god_mode');
    setSession(null);
    setIsAuthenticated(false);
    setProfile(null);
    hasAutoShownPaywall.current = false;
  };

  const completeProfile = async (name: string, role: string) => {
    if (!session?.user) return;
    const updates = {
      id: session.user.id,
      name,
      role,
      updated_at: new Date(),
    };

    const { error } = await supabase.from('profiles').upsert(updates);
    if (error) {
      console.error('Error updating profile:', error);
      return;
    }

    await fetchProfile(session.user.id);
  };

  const deductCredits = async (amount: number, details?: { model: string, base: number, mult: number }): Promise<boolean> => {
    if (userState.isAdmin) return true;

    // ★ CRITICAL: Use ref for atomic check-and-deduct (NOT React state!)
    if (balanceRef.current < amount) {
      console.warn(`[CREDIT GUARD] Blocked: ref=${balanceRef.current}, need=${amount}`);
      // ★ AUTO-PAYWALL: Immediately open pricing modal when credits insufficient
      setIsPricingOpen(true);
      console.log('[CREDIT GUARD] Auto-opened paywall: insufficient credits for deduction');
      return false;
    }

    // ★ Synchronously deduct from ref BEFORE any async work
    balanceRef.current -= amount;
    console.log(`[CREDIT DEDUCT] Deducted ${amount}, ref now=${balanceRef.current}`);

    // Update React state for UI
    setUserState(prev => ({
      ...prev,
      balance: balanceRef.current,
      monthlyUsage: prev.monthlyUsage + amount
    }));

    // ★ AUTO-PAYWALL: If balance just dropped to 0 or below, show pricing modal
    if (balanceRef.current <= 0 && !hasAutoShownPaywall.current) {
      hasAutoShownPaywall.current = true;
      setTimeout(() => {
        setIsPricingOpen(true);
        console.log('[CREDIT GUARD] Auto-opened paywall after deduction: balance =', balanceRef.current);
      }, 300);
    }

    // ★ NOTE: We do NOT call a DB RPC here.
    // The backend api/index.ts handles atomic credit reservation via reserve_credits RPC.
    // This frontend deduction is purely optimistic (keeps UI in sync instantly).

    return true;
  };

  // ★ Credit check + auto-paywall: Returns false AND opens pricing modal if insufficient
  const hasEnoughCredits = (amount: number): boolean => {
    if (userState.isAdmin) return true;
    if (balanceRef.current >= amount) return true;
    // ★ AUTO-PAYWALL: Open pricing modal automatically
    console.log(`[CREDIT GUARD] hasEnoughCredits failed: have=${balanceRef.current}, need=${amount}`);
    setIsPricingOpen(true);
    return false;
  };

  const buyCredits = async (amount: number, cost: number) => {
    if (!session?.user) return;

    const { error } = await supabase.rpc('add_credits', { amount_to_add: amount });

    // Fallback direct update
    if (error) {
      await supabase
        .from('profiles')
        .update({
          credits: balanceRef.current + amount,
          has_purchased_credits: true
        })
        .eq('id', session.user.id);
    }

    balanceRef.current += amount; // ★ Sync ref
    hasAutoShownPaywall.current = false; // Reset auto-paywall flag after purchase
    setUserState(prev => ({ ...prev, balance: balanceRef.current }));
  };

  const upgradeUser = async (tier: 'creator' | 'director') => {
    if (!session?.user) return;
    const creditsToAdd = tier === 'creator' ? 1000 : 3500;

    balanceRef.current += creditsToAdd; // ★ Sync ref
    setUserState(prev => ({ ...prev, balance: balanceRef.current, isPro: true, planType: tier }));

    await supabase
      .from('profiles')
      .update({
        credits: balanceRef.current,
        is_pro: true,
        plan_type: tier
      })
      .eq('id', session.user.id);
  };

  const enableGodMode = () => {
    balanceRef.current = 999999; // ★ Sync ref
    localStorage.setItem('ai_cine_god_mode', 'true'); // Persist session
    setUserState({ balance: 999999, isPro: true, isAdmin: true, monthlyUsage: 0, planType: 'director' });
  };

  // Safe Service Worker Cleanup
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      }).catch(err => console.log('SW Cleanup harmless error:', err));
    }
  }, []);

  return (
    <AppContext.Provider value={{
      userState,
      isAuthenticated,
      profile,
      settings,
      login,
      completeProfile,
      logout,
      toggleLang,
      updateSettings,
      deductCredits,
      buyCredits,
      upgradeUser,
      enableGodMode,
      isPricingOpen,
      openPricingModal: () => setIsPricingOpen(true),
      closePricingModal: () => setIsPricingOpen(false),
      hasEnoughCredits
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within an AppProvider");
  return context;
};
