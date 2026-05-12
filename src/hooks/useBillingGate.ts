import { useAIBillingGate } from '../context/AppDataContext';

export function useBillingGate() {
  const { billingGate, updatedAt, preflightAIGate } = useAIBillingGate();

  return {
    billingGate,
    billingGateUpdatedAt: updatedAt,
    preflightAIGate,
  };
}

export default useBillingGate;
