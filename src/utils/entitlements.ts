import { supabase } from '../../lib/supabase';

export type UserEntitlements = {
  planName: string | null;
  maxConnections: number;
  aiScanLimit: number | null;
  isPaid: boolean;
};

// Simple client-side mapping for connection limits per plan
const CONNECTION_LIMITS: Record<string, number> = {
  free: 1,
  Growth: 2,
  Pro: 3,
  Business: 5,
  Scale: 10,
};

export async function fetchUserEntitlements(): Promise<UserEntitlements> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { planName: null, maxConnections: CONNECTION_LIMITS.free, aiScanLimit: null, isPaid: false };

  const { data: usr } = await supabase
    .from('Users')
    .select('SubscriptionTierId')
    .eq('Id', user.id)
    .maybeSingle();

  if (!usr?.SubscriptionTierId) {
    return { planName: null, maxConnections: CONNECTION_LIMITS.free, aiScanLimit: null, isPaid: false };
  }

  const { data: tier } = await supabase
    .from('SubscriptionTiers')
    .select('Name, AiScans')
    .eq('Id', usr.SubscriptionTierId)
    .maybeSingle();

  const planName = tier?.Name ?? null;
  const aiScanLimit = tier?.AiScans ?? null;
  const maxConnections = planName && CONNECTION_LIMITS[planName] ? CONNECTION_LIMITS[planName] : CONNECTION_LIMITS.free;
  const isPaid = planName !== null; // naive: any assigned tier considered paid
  return { planName, maxConnections, aiScanLimit, isPaid };
}


