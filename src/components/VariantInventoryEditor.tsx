import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import VariantInventoryRow from './VariantInventoryRow';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformLogo from './PlatformLogo';

export interface InventoryItemData {
  quantity: number;
  price?: number;
  image?: string;
  connectionId?: string;
}

export interface VariantInventoryEditorProps {
  // Data Source
  variants: Array<{
    id: string;
    name: string;
    image?: string;
    // Map of locationId -> Inventory Data. Using generic Record to be flexible
    inventory: Record<string, InventoryItemData>;
    defaultPrice?: number;
  }>;

  // Context
  activeTab: string; // 'all' or platformKey
  locations: Array<{
    id: string;
    locationId?: string;
    name: string;
    platformKey: string;
    connectionId?: string;
    connectionName?: string;
    isGlobal?: boolean;
  }>;

  // Configuration
  isGenerationMode?: boolean; // If true, enables override styling

  // Callbacks
  onUpdateInventory: (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => void;
  onSelectImage?: (variantId: string) => void;

  // External update highlight (green border) – from realtime inventory subscription
  hasExternalUpdateQuantity?: (variantId: string, locationId: string) => boolean;
  hasExternalUpdatePrice?: (variantId: string, locationId: string) => boolean;
}

// Inline editable price/qty row for "All" tab
const AllTabRow: React.FC<{
  variantId: string;
  locId: string;
  locName: string;
  platformKey: string;
  isGlobal?: boolean;
  quantity: number;
  price: number;
  onUpdateInventory: (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => void;
  externalUpdateQuantity?: boolean;
  externalUpdatePrice?: boolean;
}> = ({ variantId, locId, locName, platformKey, isGlobal, quantity, price, onUpdateInventory, externalUpdateQuantity, externalUpdatePrice }) => {
  const isShopifyGlobal = platformKey === 'shopify' && !!isGlobal;
  const displayName = locName?.length > 18 ? locName.slice(0, 18) + '…' : locName;

  // Local state for smooth typing
  const [localQty, setLocalQty] = useState(String(quantity));
  const [localPrice, setLocalPrice] = useState(String(price));
  const qtyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from props when they change externally
  useEffect(() => {
    setLocalQty(String(quantity));
  }, [quantity]);

  useEffect(() => {
    setLocalPrice(String(price));
  }, [price]);

  const handleQtyChange = (text: string) => {
    const num = text.replace(/[^0-9]/g, '');
    setLocalQty(num);
    if (qtyTimeout.current) clearTimeout(qtyTimeout.current);
    qtyTimeout.current = setTimeout(() => {
      onUpdateInventory(variantId, locId, 'quantity', Number(num || '0'));
    }, 400);
  };

  const handlePriceChange = (text: string) => {
    // Allow digits and single decimal point
    const num = text.replace(/[^0-9.]/g, '');
    setLocalPrice(num);
    if (priceTimeout.current) clearTimeout(priceTimeout.current);
    priceTimeout.current = setTimeout(() => {
      onUpdateInventory(variantId, locId, 'price', Number(num || '0'));
    }, 400);
  };

  return (
    <View style={styles.allRowCard}>
      {/* Platform Logo + Location Name */}
      <View style={styles.allRowHeader}>
        <PlatformLogo type={platformKey} size={18} />
        <Text style={styles.locationName} numberOfLines={1}>{displayName}</Text>
        {isShopifyGlobal && (
          <View style={styles.globalBadge}>
            <Text style={styles.globalBadgeText}>GLOBAL</Text>
          </View>
        )}
      </View>

      {/* Quantity Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Qty</Text>
        <View style={styles.qtyContainer}>
          <TouchableOpacity
            onPress={() => handleQtyChange(String(Math.max(0, Number(localQty || 0) - 1)))}
            style={styles.qtyBtnLeft}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 5 }}
          >
            <Icon name="minus" size={14} color="#374151" />
          </TouchableOpacity>
          <TextInput
            style={styles.qtyInput}
            value={localQty}
            onChangeText={handleQtyChange}
            keyboardType="number-pad"
            selectTextOnFocus
          />
          <TouchableOpacity
            onPress={() => handleQtyChange(String(Number(localQty || 0) + 1))}
            style={styles.qtyBtnRight}
            hitSlop={{ top: 10, bottom: 10, left: 5, right: 10 }}
          >
            <Icon name="plus" size={14} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Price Input - Blue for Shopify global */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Price</Text>
        <View style={[styles.priceInputContainer, isShopifyGlobal && styles.priceInputShopify]}>
          <Text style={[styles.currencySymbol, isShopifyGlobal && { color: '#1976D2' }]}>$</Text>
          <TextInput
            style={[styles.priceInput, isShopifyGlobal && styles.priceInputTextShopify, externalUpdatePrice && { borderColor: '#93C822', borderWidth: 2 }]}
            value={localPrice}
            onChangeText={handlePriceChange}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
        </View>
      </View>
    </View>
  );
};

const VariantInventoryEditor: React.FC<VariantInventoryEditorProps> = ({
  variants,
  activeTab,
  locations,
  isGenerationMode = false,
  onUpdateInventory,
  onSelectImage,
  hasExternalUpdateQuantity,
  hasExternalUpdatePrice,
}) => {
  const theme = useTheme();

  /**
   * Pass inventory updates directly to parent.
   * NOTE: Global Shopify pricing is handled by the PARENT (ListingEditorForm.handleUpdateInventory)
   * which already propagates price changes to ALL Shopify locations.
   * We just pass through a single update - no need to call for each location here.
   */
  const handleInventoryUpdate = (
    variantId: string,
    locationId: string,
    field: 'quantity' | 'price',
    value: number
  ) => {
    // Just pass through - parent handles Shopify global pricing at ListingEditorForm lines 1502-1521
    onUpdateInventory(variantId, locationId, field, value);
  };

  // --- "All" Tab View ---
  // Shows ALL locations across ALL platforms with editable rows
  if (activeTab === 'all') {
    return (
      <View style={styles.container}>
        {variants.length === 0 ? (
          <Text style={styles.emptyText}>No variants available</Text>
        ) : (
          variants.map((variant) => (
            <View key={variant.id} style={styles.variantSection}>
              {/* Hide section title for single base product (non-variant) */}
              {!(variants.length === 1 && variant.id === '_base') && (
                <Text style={styles.sectionTitle}>{variant.name}</Text>
              )}

              {locations.length === 0 ? (
                <Text style={styles.emptyText}>No locations available</Text>
              ) : (
                locations.map((loc) => {
                  const invKey = loc.id;
                  const data = variant.inventory[invKey] || { quantity: 0, price: undefined };

                  // Use per-location price only in "all" tab to avoid cross-platform bleed
                  const currentPrice = data.price ?? 0;

                  return (
                    <AllTabRow
                      key={`${variant.id}-${loc.id}`}
                      variantId={variant.id}
                      locId={loc.id}
                      locName={loc.name}
                      platformKey={loc.platformKey}
                      isGlobal={loc.isGlobal}
                      quantity={data.quantity}
                      price={currentPrice}
                      onUpdateInventory={handleInventoryUpdate}
                      externalUpdateQuantity={hasExternalUpdateQuantity?.(variant.id, loc.id)}
                      externalUpdatePrice={hasExternalUpdatePrice?.(variant.id, loc.id)}
                    />
                  );
                })
              )}
            </View>
          ))
        )}
      </View>
    );
  }

  // --- Platform Specific View ---
  // FILTER locations for THIS platform only (case-insensitive)
  const activeTabLower = activeTab.toLowerCase();
  const platformLocations = locations.filter(l => l.platformKey.toLowerCase() === activeTabLower);
  const isShopify = activeTabLower === 'shopify';

  return (
    <View style={styles.container}>
      {variants.length === 0 ? (
        <Text style={styles.emptyText}>No variants available</Text>
      ) : (
        variants.map((variant) => (
          <View key={variant.id} style={styles.variantGroup}>
            {platformLocations.length === 0 ? (
              <Text style={styles.emptyText}>No locations for {activeTab}</Text>
            ) : (
              platformLocations.map((loc) => {
                const invKey = loc.id;
                const data = variant.inventory[invKey] || { quantity: 0, price: undefined };

                // Use per-location price, fallback to default only if not set
                const currentPrice = data.price ?? variant.defaultPrice ?? 0;

                // Override Logic: ONLY in generation mode
                const isOverride = false; // Never show override in editor - only GenerateDetails sets this

                return (
                  <View key={`${variant.id}-${loc.id}`} style={{ marginBottom: 10 }}>
                    <VariantInventoryRow
                      variantName={variant.name}
                      variantId={variant.id}
                      invKey={invKey}
                      quantity={data.quantity}
                      price={currentPrice}
                      image={data.image || variant.image}

                      // Flags - Blue styling for Shopify
                      isGlobalPrice={isShopify && !!loc.isGlobal}
                      isOverride={isOverride}
                      isGenerationMode={isGenerationMode}

                      // External update highlight (green border)
                      externalUpdateQuantity={hasExternalUpdateQuantity?.(variant.id, invKey)}
                      externalUpdatePrice={hasExternalUpdatePrice?.(variant.id, invKey)}

                      // Handlers - Use internal wrapper for global Shopify pricing
                      onChangeQuantity={(q) => handleInventoryUpdate(variant.id, invKey, 'quantity', q)}
                      onChangePrice={(p) => handleInventoryUpdate(variant.id, invKey, 'price', p)}
                      onSelectImage={() => onSelectImage?.(variant.id)}
                    />
                  </View>
                );
              })
            )}
          </View>
        ))
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  variantSection: {
    marginBottom: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  variantGroup: {
    marginBottom: 4,
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
    fontSize: 13,
  },
  // All Tab Styles - Editable Rows
  allRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    backgroundColor: '#FFF',
    marginBottom: 8,
    gap: 8,
  },
  allRowHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  locationName: {
    fontWeight: '600',
    fontSize: 12,
    color: '#000',
    flexShrink: 1,
  },
  globalBadge: {
    backgroundColor: '#E3F2FD',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  globalBadgeText: {
    fontSize: 9,
    color: '#1976D2',
    fontWeight: '600',
  },
  // Input Groups
  inputGroup: {
    alignItems: 'center',
    gap: 4,
  },
  inputLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 999, // Pill shape
    height: 36,
    paddingHorizontal: 2,
  },
  qtyBtnLeft: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
  },
  qtyBtnRight: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#E5E7EB',
  },
  qtyInput: {
    color: '#111827',
    fontWeight: '600',
    width: 40,
    textAlign: 'center',
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FFF',
    height: 36,
  },
  priceInputShopify: {
    borderColor: '#1976D2', // Global Blue 
    backgroundColor: '#E3F2FD', // Light green
    borderWidth: 1.5,
  },
  currencySymbol: {
    color: '#9CA3AF',
    paddingLeft: 8,
    fontSize: 13,
    fontWeight: '500',
  },
  priceInput: {
    color: '#111827',
    fontWeight: '600',
    width: 70,
    textAlign: 'left',
    fontSize: 14,
    paddingVertical: 0,
    paddingHorizontal: 4,
    height: '100%',
  },
  priceInputTextShopify: {
    color: '#1976D2', // Global Blue text
  },
});

export default VariantInventoryEditor;
