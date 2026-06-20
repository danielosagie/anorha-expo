import React, { useState, useEffect, useRef } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import VariantInventoryRow from './VariantInventoryRow';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';

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

// A debounced qty stepper (+ optional per-location price) for one location in the "All" tab.
const LocationRow: React.FC<{
  variantId: string;
  locId: string;
  locName: string;
  quantity: number;
  price?: number; // undefined → price is shared at the platform-group level (hide it here)
  onUpdateInventory: (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => void;
  externalUpdateQuantity?: boolean;
  externalUpdatePrice?: boolean;
}> = ({ variantId, locId, locName, quantity, price, onUpdateInventory, externalUpdateQuantity, externalUpdatePrice }) => {
  const showPrice = price !== undefined;
  const [localQty, setLocalQty] = useState(String(quantity));
  const [localPrice, setLocalPrice] = useState(price == null ? '' : String(Number.isFinite(price) ? price : 0));
  const qtyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setLocalQty(String(quantity)); }, [quantity]);
  useEffect(() => { if (price != null) setLocalPrice(String(Number.isFinite(price) ? price : 0)); }, [price]);

  const handleQtyChange = (text: string) => {
    const num = text.replace(/[^0-9]/g, '');
    setLocalQty(num);
    if (qtyTimeout.current) clearTimeout(qtyTimeout.current);
    qtyTimeout.current = setTimeout(() => onUpdateInventory(variantId, locId, 'quantity', Number(num || '0')), 400);
  };
  const handlePriceChange = (text: string) => {
    const num = text.replace(/[^0-9.]/g, '');
    setLocalPrice(num);
    if (priceTimeout.current) clearTimeout(priceTimeout.current);
    priceTimeout.current = setTimeout(() => onUpdateInventory(variantId, locId, 'price', Number(num || '0')), 400);
  };

  return (
    <View style={styles.locRow}>
      <Text style={styles.locName} numberOfLines={1}>{locName}</Text>
      <View style={styles.locControls}>
        <View style={[styles.qtyContainer, externalUpdateQuantity && styles.externalQty]}>
          <TouchableOpacity
            onPress={() => handleQtyChange(String(Math.max(0, Number(localQty || 0) - 1)))}
            style={styles.qtyBtnLeft}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 5 }}
          >
            <Icon name="minus" size={16} color="#374151" />
          </TouchableOpacity>
          <TextInput style={styles.qtyInput} value={localQty} onChangeText={handleQtyChange} keyboardType="number-pad" selectTextOnFocus />
          <TouchableOpacity
            onPress={() => handleQtyChange(String(Number(localQty || 0) + 1))}
            style={styles.qtyBtnRight}
            hitSlop={{ top: 10, bottom: 10, left: 5, right: 10 }}
          >
            <Icon name="plus" size={16} color="#374151" />
          </TouchableOpacity>
        </View>

        {showPrice && (
          <View style={[styles.priceInputContainer, externalUpdatePrice && { borderColor: BRAND_PRIMARY, borderWidth: 2 }]}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput style={styles.priceInput} value={localPrice} onChangeText={handlePriceChange} keyboardType="decimal-pad" selectTextOnFocus />
          </View>
        )}
      </View>
    </View>
  );
};

// A single shared price for a platform group whose stores all share one price (e.g. Shopify global).
const GroupSharedPriceRow: React.FC<{
  variantId: string;
  locId: string; // any location in the group — parent propagates the price to all
  price: number;
  onUpdateInventory: (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => void;
  externalUpdatePrice?: boolean;
}> = ({ variantId, locId, price, onUpdateInventory, externalUpdatePrice }) => {
  const [local, setLocal] = useState(String(Number.isFinite(price) ? price : 0));
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setLocal(String(Number.isFinite(price) ? price : 0)); }, [price]);
  const handle = (text: string) => {
    const num = text.replace(/[^0-9.]/g, '');
    setLocal(num);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => onUpdateInventory(variantId, locId, 'price', Number(num || '0')), 400);
  };
  return (
    <View style={styles.groupPriceRow}>
      <Text style={styles.groupPriceLabel}>Price · all locations</Text>
      <View style={[styles.priceInputContainer, externalUpdatePrice && { borderColor: BRAND_PRIMARY, borderWidth: 2 }]}>
        <Text style={styles.currencySymbol}>$</Text>
        <TextInput style={styles.priceInput} value={local} onChangeText={handle} keyboardType="decimal-pad" selectTextOnFocus />
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
                (() => {
                  // Group this variant's locations by platform so each channel reads as one
                  // block with a quiet "share price" note, not a wall of GLOBAL badges.
                  const groups: Array<{ platformKey: string; locs: typeof locations }> = [];
                  for (const loc of locations) {
                    let g = groups.find((x) => x.platformKey === loc.platformKey);
                    if (!g) { g = { platformKey: loc.platformKey, locs: [] }; groups.push(g); }
                    g.locs.push(loc);
                  }
                  return groups.map((group) => {
                    const def = getPlatform(group.platformKey);
                    // Shopify shares one price across all its stores ("global").
                    const sharesPrice = group.platformKey.toLowerCase() === 'shopify' && group.locs.some((l) => l.isGlobal);
                    const firstLoc = group.locs[0];
                    const sharedPrice = (variant.inventory[firstLoc?.id]?.price) ?? variant.defaultPrice ?? 0;
                    return (
                      <View key={group.platformKey} style={styles.platformGroup}>
                        <View style={styles.platformGroupHeader}>
                          {def && <PlatformLogo type={group.platformKey} size={18} />}
                          <Text style={styles.platformGroupName}>{def?.label || group.platformKey}</Text>
                          {sharesPrice && <Text style={styles.shareNote}>· all stores share price</Text>}
                        </View>

                        {sharesPrice && firstLoc && (
                          <GroupSharedPriceRow
                            variantId={variant.id}
                            locId={firstLoc.id}
                            price={sharedPrice}
                            onUpdateInventory={handleInventoryUpdate}
                            externalUpdatePrice={hasExternalUpdatePrice?.(variant.id, firstLoc.id)}
                          />
                        )}

                        {group.locs.map((loc) => {
                          const data = variant.inventory[loc.id] || { quantity: 0, price: undefined };
                          return (
                            <LocationRow
                              key={`${variant.id}-${loc.id}`}
                              variantId={variant.id}
                              locId={loc.id}
                              locName={loc.name}
                              quantity={data.quantity}
                              price={sharesPrice ? undefined : (data.price ?? 0)}
                              onUpdateInventory={handleInventoryUpdate}
                              externalUpdateQuantity={hasExternalUpdateQuantity?.(variant.id, loc.id)}
                              externalUpdatePrice={hasExternalUpdatePrice?.(variant.id, loc.id)}
                            />
                          );
                        })}
                      </View>
                    );
                  });
                })()
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
  // Grouped "All" tab — one block per platform, quiet share-price note, no GLOBAL badge spam.
  platformGroup: {
    marginBottom: 6,
  },
  platformGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  platformGroupName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#18181B',
  },
  shareNote: {
    fontSize: 12,
    fontWeight: '400',
    color: '#9CA3AF',
  },
  groupPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F1F3',
  },
  groupPriceLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3F3F46',
  },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F1F3',
  },
  locName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
  },
  locControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  externalQty: {
    borderWidth: 2,
    borderColor: BRAND_PRIMARY,
  },
  // All Tab Styles - Editable Rows
  // Flat 2-line row: name on top, controls below, hairline divider between rows.
  allRowCard: {
    flexDirection: 'column',
    gap: 12,
    paddingHorizontal: 2,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F1F3',
    backgroundColor: 'transparent',
  },
  allRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minWidth: 0,
  },
  allRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationName: {
    fontWeight: '600',
    fontSize: 15,
    color: '#111827',
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
  // Input Groups — label sits inline to the left of the control.
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 2,
  },
  qtyBtnLeft: {
    paddingHorizontal: 14,
    height: '100%',
    justifyContent: 'center',
  },
  qtyBtnRight: {
    paddingHorizontal: 14,
    height: '100%',
    justifyContent: 'center',
  },
  qtyInput: {
    color: '#111827',
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
    fontSize: 15,
    height: '100%',
    padding: 0,
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FFF',
    height: 40,
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
