
import { loadStripe } from '@stripe/stripe-js';
import { STRIPE_PUBLISHABLE_KEY } from '../types';

let stripePromise: Promise<any> | null = null;

const getStripe = () => {
  if (!stripePromise) {
    // In a real app, you would install @stripe/stripe-js
    // For this environment, we load it from CDN if needed, or assume the user installs the package
    // Here we use the standard loadStripe function.
    // Ensure you have run: npm install @stripe/stripe-js
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
};

export const initiateCheckout = async (userId: string) => {
  console.log(`[Stripe] Redirecting to Payment Link for user ${userId}`);

  // The client_reference_id allows the webhook to identify which user paid
  const paymentLink = `https://buy.stripe.com/00w28s8DX94O1XCgiegnK05?client_reference_id=${userId}`;

  window.location.href = paymentLink;
};
