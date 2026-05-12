import { useState, useEffect, useCallback } from 'react';
import { 
  ShopifyGraphQLClient, 
  Product, 
  Location, 
  createShopifyClient,
  InventoryLevel 
} from '../../lib/shopifyGraphQL';

export interface UseShopifyProductsConfig {
  storeName: string;
  accessToken: string;
  accountId?: string; // For multi-account support
}

export interface ProductOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ShopifyProductsState {
  products: Product[];
  locations: Location[];
  selectedLocation?: Location;
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  endCursor?: string;
}

export const useShopifyProducts = (config: UseShopifyProductsConfig) => {
  const [state, setState] = useState<ShopifyProductsState>({
    products: [],
    locations: [],
    loading: false,
    error: null,
    hasNextPage: false,
  });

  const [client, setClient] = useState<ShopifyGraphQLClient | null>(null);

  // Initialize Shopify client
  useEffect(() => {
    if (config.storeName && config.accessToken) {
      const shopifyClient = createShopifyClient(config.storeName, config.accessToken);
      setClient(shopifyClient);
    }
  }, [config.storeName, config.accessToken]);

  // Load initial data
  useEffect(() => {
    if (client) {
      loadInitialData();
    }
  }, [client]);

  const loadInitialData = async () => {
    if (!client) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Load locations first
      const locations = await client.getLocations();
      
      // Load products
      const { products, hasNextPage, endCursor } = await client.getProducts();

      setState(prev => ({
        ...prev,
        products,
        locations,
        hasNextPage,
        endCursor,
        loading: false,
        selectedLocation: locations[0] || undefined,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load data',
        loading: false,
      }));
    }
  };

  // Product CRUD Operations

  const readProducts = useCallback(async (
    options?: {
      first?: number;
      after?: string;
      query?: string;
      refresh?: boolean;
    }
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const { products, hasNextPage, endCursor } = await client.getProducts(
        options?.first,
        options?.after,
        options?.query
      );

      const updatedProducts = options?.refresh || options?.after 
        ? [...state.products, ...products]
        : products;

      setState(prev => ({
        ...prev,
        products: updatedProducts,
        hasNextPage,
        endCursor,
        loading: false,
      }));

      return { success: true, data: { products, hasNextPage, endCursor } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to read products';
      setState(prev => ({ ...prev, error: errorMessage, loading: false }));
      return { success: false, error: errorMessage };
    }
  }, [client, state.products]);

  const readProductById = useCallback(async (id: string): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const product = await client.getProductById(id);
      return { success: true, data: product };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to read product';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  const updateProduct = useCallback(async (
    productUpdate: Partial<Product> & { id: string }
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const updatedProduct = await client.updateProduct(productUpdate);
      
      // Update local state
      setState(prev => ({
        ...prev,
        products: prev.products.map(p => 
          p.id === updatedProduct.id ? { ...p, ...updatedProduct } : p
        ),
      }));

      return { success: true, data: updatedProduct };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update product';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  const archiveProduct = useCallback(async (productId: string): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const archivedProduct = await client.archiveProduct(productId);
      
      // Update local state to reflect archived status
      setState(prev => ({
        ...prev,
        products: prev.products.map(p => 
          p.id === productId ? { ...p, status: 'ARCHIVED' as const } : p
        ),
      }));

      return { success: true, data: archivedProduct };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to archive product';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  const deleteProduct = useCallback(async (productId: string): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const deletedId = await client.deleteProduct(productId);
      
      // Remove from local state
      setState(prev => ({
        ...prev,
        products: prev.products.filter(p => p.id !== productId),
      }));

      return { success: true, data: { deletedId } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete product';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  // Location-based operations

  const getProductsByLocation = useCallback(async (
    locationId: string,
    first: number = 50
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const products = await client.getProductsByLocation(locationId, first);
      
      setState(prev => ({
        ...prev,
        products,
        loading: false,
      }));

      return { success: true, data: products };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get products by location';
      setState(prev => ({ ...prev, error: errorMessage, loading: false }));
      return { success: false, error: errorMessage };
    }
  }, [client]);

  const adjustInventoryAtLocation = useCallback(async (
    inventoryItemId: string,
    locationId: string,
    quantityDelta: number,
    reason: string = 'correction'
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const adjustmentResult = await client.adjustInventoryAtLocation(
        inventoryItemId,
        locationId,
        quantityDelta,
        reason
      );

      // Refresh products to get updated inventory
      await readProducts({ refresh: true });

      return { success: true, data: adjustmentResult };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to adjust inventory';
      return { success: false, error: errorMessage };
    }
  }, [client, readProducts]);

  const getInventoryLevels = useCallback(async (
    inventoryItemId: string,
    locationIds?: string[]
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const inventoryLevels = await client.getInventoryLevels(inventoryItemId, locationIds);
      return { success: true, data: inventoryLevels };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get inventory levels';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  // Bulk operations

  const bulkArchiveProducts = useCallback(async (
    productIds: string[]
  ): Promise<ProductOperationResult> => {
    if (!client) return { success: false, error: 'Client not initialized' };

    try {
      const archivedProducts = await client.bulkArchiveProducts(productIds);
      
      // Update local state
      setState(prev => ({
        ...prev,
        products: prev.products.map(p => 
          productIds.includes(p.id) ? { ...p, status: 'ARCHIVED' as const } : p
        ),
      }));

      return { success: true, data: archivedProducts };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to bulk archive products';
      return { success: false, error: errorMessage };
    }
  }, [client]);

  // Utility functions

  const setSelectedLocation = useCallback((location: Location) => {
    setState(prev => ({ ...prev, selectedLocation: location }));
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const refreshData = useCallback(async () => {
    await loadInitialData();
  }, [client]);

  // Filter functions for UI
  const getActiveProducts = useCallback(() => {
    return state.products.filter(p => p.status === 'ACTIVE');
  }, [state.products]);

  const getArchivedProducts = useCallback(() => {
    return state.products.filter(p => p.status === 'ARCHIVED');
  }, [state.products]);

  const getDraftProducts = useCallback(() => {
    return state.products.filter(p => p.status === 'DRAFT');
  }, [state.products]);

  const getProductsByStatus = useCallback((status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT') => {
    return state.products.filter(p => p.status === status);
  }, [state.products]);

  return {
    // State
    ...state,
    
    // Operations
    readProducts,
    readProductById,
    updateProduct,
    archiveProduct,
    deleteProduct,
    
    // Location-based operations
    getProductsByLocation,
    adjustInventoryAtLocation,
    getInventoryLevels,
    
    // Bulk operations
    bulkArchiveProducts,
    
    // Utilities
    setSelectedLocation,
    clearError,
    refreshData,
    
    // Filters
    getActiveProducts,
    getArchivedProducts,
    getDraftProducts,
    getProductsByStatus,
    
    // Loading more products
    loadMore: () => readProducts({ 
      after: state.endCursor,
      first: 50 
    }),
  };
}; 