import { useProductCount } from '../context/AppDataContext';

interface UseProfileProductCountReturn {
  productCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProfileProductCount(): UseProfileProductCountReturn {
  const { productCount, loading, error, refresh } = useProductCount();

  return { productCount, loading, error, refresh };
}

export default useProfileProductCount;
