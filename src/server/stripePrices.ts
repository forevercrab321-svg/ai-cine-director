export type TopupKey = "starter_pack" | "value_pack" | "pro_pack";
export type PlanKey = "creator_monthly" | "director_monthly" | "creator_yearly" | "director_yearly";

export const PRICE_TO_PRODUCT: Record<string, {
  kind: "topup" | "subscription";
  topup_key?: TopupKey;
  credits?: number;            // topup credits
  plan_key?: PlanKey;
  monthly_credits?: number;    // subscription monthly credits
}> = {
  // topups
  [process.env.STRIPE_PRICE_STARTER_PACK!]: { kind: "topup", topup_key: "starter_pack", credits: 500 },
  [process.env.STRIPE_PRICE_VALUE_PACK!]:   { kind: "topup", topup_key: "value_pack",   credits: 1200 },
  [process.env.STRIPE_PRICE_PRO_PACK!]:     { kind: "topup", topup_key: "pro_pack",     credits: 3500 },

  // subscriptions
  [process.env.STRIPE_PRICE_CREATOR_MONTHLY!]: { kind: "subscription", plan_key: "creator_monthly", monthly_credits: 1200 },
  [process.env.STRIPE_PRICE_DIRECTOR_MONTHLY!]: { kind: "subscription", plan_key: "director_monthly", monthly_credits: 3500 },
  [process.env.STRIPE_PRICE_CREATOR_YEARLY!]: { kind: "subscription", plan_key: "creator_yearly", monthly_credits: 1200 },
  [process.env.STRIPE_PRICE_DIRECTOR_YEARLY!]: { kind: "subscription", plan_key: "director_yearly", monthly_credits: 3500 },
};
