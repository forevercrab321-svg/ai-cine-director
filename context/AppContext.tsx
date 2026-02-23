
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
  refreshBalance: () => Promise<void>; // ★ NEW: Sync balance from DB

  // UI Control
  isPricingOpen: boolean;
  openPricingModal: () => void;
  closePricingModal: () => void;

  // ★ NEW: Credit guard helpers
  hasEnoughCredits: (amount: number) => boolean;
}

// ★ No free credits — users must purchase credits via Stripe

// ★ DEVELOPER EMAIL REGISTRY - for automatic admin mode detection
const DEVELOPER_EMAILS = new Set([
  'forevercrab321@gmail.com'
]);

// ★ Helper function to check if email is a developer/admin
const isDeveloperEmail = (email: string): boolean => {
  const lowerEmail = email?.toLowerCase() || '';
  return DEVELOPER_EMAILS.has(lowerEmail);
};

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

  const fetchProfile = async (userId: string, userEmail?: string) => {
    try {
      console.log(`[PROFILE] Fetching profile for user: ${userId}, email: ${userEmail}`);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        const noRow = error?.code === 'PGRST116';
        if (noRow) {
          const { error: createErr } = await supabase
            .from('profiles')
            .insert({ id: userId, name: userEmail || 'Director', role: 'Director', credits: 50 });
          if (!createErr) {
            return fetchProfile(userId, userEmail);
          }
        }
        console.error('Error fetching profile:', error);
        return;
      }

      if (data) {
        setProfile({ id: data.id, name: data.name, role: data.role });

        // ★ AUTO-HEAL: Fix legacy negative balances from old Vercel deployments
        let newBalance = data.credits ?? 0;
        if (newBalance < 0) {
          console.log(`[CREDIT] Auto-healing legacy negative balance (${newBalance} -> 0)`);
          newBalance = 0;
          // Fire and forget DB heal
          supabase.from('profiles').update({ credits: 0 }).eq('id', userId).then();
        }

        // ★ AUTO-GRANT: If brand-new user still has 0 credits, grant initial 50
        if (!data.is_admin && newBalance === 0 && data.created_at) {
          const createdAt = new Date(data.created_at).getTime();
          const isNew = Date.now() - createdAt < 10 * 60 * 1000; // 10 minutes
          if (isNew) {
            const { error: grantErr } = await supabase
              .from('profiles')
              .update({ credits: 50 })
              .eq('id', userId);
            if (!grantErr) {
              newBalance = 50;
            }
          }
        }

        // ★ AUTO-DETECT DEVELOPER: Check if email is in developer registry
        const isDeveloper = userEmail ? isDeveloperEmail(userEmail) : data.is_admin;
        console.log(`[PROFILE] isDeveloper check: email="${userEmail}", isDeveloper=${isDeveloper}, isDeveloperEmail result=${userEmail ? isDeveloperEmail(userEmail) : 'N/A'}`);
        
        // Restore God Mode from LocalStorage if active
        const isGodMode = localStorage.getItem('ai_cine_god_mode') === 'true';
        console.log(`[PROFILE] isGodMode=${isGodMode}, data.is_admin=${data.is_admin}`);

        if (isGodMode || isDeveloper || data.is_admin) {
          console.log(`[ADMIN] ✅ ACTIVATING ADMIN MODE for ${userEmail}`);
          balanceRef.current = 999999;
          setUserState({
            balance: 999999,
            isPro: true,
            isAdmin: true,
            monthlyUsage: 0,
            planType: 'director'
          });
          console.log(`[ADMIN] User ${userEmail} detected as developer/admin`, { isDeveloper, isGodMode, dbAdmin: data.is_admin });
        } else {
          console.log(`[ADMIN] ❌ NOT ADMIN - normal user balance=${newBalance}`);
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
        fetchProfile(currentSession.user.id, currentSession.user.email);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        setIsAuthenticated(true);
        fetchProfile(newSession.user.id, newSession.user.email);
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

    // ★ CRITICAL: Pure guard check — does NOT write to DB (backend API handles DB deduction)
    // This prevents DOUBLE DEDUCTION (frontend ref + backend RPC both deducting)
    if (balanceRef.current < amount || balanceRef.current <= 0) {
      console.warn(`[CREDIT GUARD] Blocked: ref=${balanceRef.current}, need=${amount}`);
      setIsPricingOpen(true);
      return false;
    }

    // ★ PURE GUARD — DO NOT deduct here. The backend reserve_credits RPC handles ALL deduction.
    // We only mark the ref as "reserved" to prevent rapid-click race conditions in the UI.
    // refreshBalance() will sync the TRUE value from DB after the backend call completes.
    balanceRef.current = balanceRef.current - amount;
    console.log(`[CREDIT GUARD] UI pre-reserved ${amount}, ref now=${balanceRef.current}`);

    // Update React state for immediate UI feedback
    setUserState(prev => ({
      ...prev,
      balance: balanceRef.current
    }));

    // ★ AUTO-PAYWALL: If balance hits 0, show pricing for NEXT action
    if (balanceRef.current <= 0 && !hasAutoShownPaywall.current) {
      hasAutoShownPaywall.current = true;
      setTimeout(() => {
        setIsPricingOpen(true);
        console.log('[CREDIT GUARD] Auto-opened paywall: balance =', balanceRef.current);
      }, 500);
    }

    return true;
  };

  // ★ Credit check + auto-paywall: Returns false AND opens pricing modal if insufficient
  const hasEnoughCredits = (amount: number): boolean => {
    if (userState.isAdmin) return true;
    const available = balanceRef.current;
    if (available >= amount) return true;
    console.log(`[CREDIT GUARD] hasEnoughCredits failed: have=${available}, need=${amount}`);
    setIsPricingOpen(true);
    return false;
  };

  // ★ NEW: Refresh balance from DB (call after API operations)
  const refreshBalance = async () => {
    if (!session?.user) return;
    
    // ★ IMPORTANT: If user is admin, don't override their 999999 balance
    if (userState.isAdmin) {
      console.log(`[CREDIT SYNC] Skipping refresh for admin user (keeping balance=${balanceRef.current})`);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', session.user.id)
        .single();
      if (!error && data) {
        const dbBalance = data.credits ?? 0; // ★ NO CLAMPING — show real value from DB
        balanceRef.current = dbBalance;
        setUserState(prev => ({ ...prev, balance: dbBalance }));
        console.log(`[CREDIT SYNC] Balance refreshed from DB: ${dbBalance}`);

        // Auto-paywall if DB says 0
        if (dbBalance <= 0 && !hasAutoShownPaywall.current) {
          hasAutoShownPaywall.current = true;
          setIsPricingOpen(true);
        }
      }
    } catch (e) {
      console.error('[CREDIT SYNC] Failed to refresh balance:', e);
    }
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

    balanceRef.current = Math.max(0, balanceRef.current + amount); // ★ Sync ref, clamp
    hasAutoShownPaywall.current = false; // Reset auto-paywall flag after purchase
    setUserState(prev => ({ ...prev, balance: Math.max(0, balanceRef.current) }));
  };

  const upgradeUser = async (tier: 'creator' | 'director') => {
    if (!session?.user) return;
    const creditsToAdd = tier === 'creator' ? 1000 : 3500;

    balanceRef.current = Math.max(0, balanceRef.current + creditsToAdd); // ★ Sync ref, clamp
    setUserState(prev => ({ ...prev, balance: Math.max(0, balanceRef.current), isPro: true, planType: tier }));

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
      refreshBalance,
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

// ★ Export helper to check if email is developer (for use in components)
export { isDeveloperEmail, DEVELOPER_EMAILS };
