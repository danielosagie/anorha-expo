import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

export interface VariantInventoryEditorProps {
  variant: {
    id: string;
    name: string;
    optionValues?: Record<string, string>;
    price?: number;
    inventoryByLocation: Record<string, { quantity: number; price?: number; image?: string }>;
    image?: string;
  };
  locations: Array<{ id: string; name: string }>;
  selectedLocationId: string;
  platformKey?: string;
  supportsPerLocationPricing?: boolean;
  onQuantityChange: (quantity: number) => void;
  onPriceChange: (price: number) => void;
  onLocationChange?: (locationId: string) => void;
  onVariantImageSelect?: () => void;
  readonly?: boolean;
}

const VariantInventoryEditor: React.FC<VariantInventoryEditorProps> = ({
  variant,
  locations,
  selectedLocationId,
  platformKey = 'shopify',
  supportsPerLocationPricing = true,
  onQuantityChange,
  onPriceChange,
  onLocationChange,
  onVariantImageSelect,
  readonly = false,
}) => {
  const theme = useTheme();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [quantityStr, setQuantityStr] = useState(
    String((variant.inventoryByLocation?.[selectedLocationId]?.quantity) ?? 0)
  );
  const [priceStr, setPriceStr] = useState(
    String((variant.inventoryByLocation?.[selectedLocationId]?.price) ?? variant.price ?? 0)
  );

  React.useEffect(() => {
    setQuantityStr(String((variant.inventoryByLocation?.[selectedLocationId]?.quantity) ?? 0));
    setPriceStr(String((variant.inventoryByLocation?.[selectedLocationId]?.price) ?? variant.price ?? 0));
  }, [selectedLocationId, variant]);

  const selectedLocation = locations.find(l => l.id === selectedLocationId);
  const currentInventory = variant.inventoryByLocation?.[selectedLocationId] || { quantity: 0, price: undefined };
  const variantImage = currentInventory.image || variant.image;

  const handleQuantityChange = (value: string) => {
    setQuantityStr(value);
    const qty = parseInt(value, 10);
    if (!isNaN(qty)) {
      onQuantityChange(qty);
    }
  };

  const handlePriceChange = (value: string) => {
    setPriceStr(value);
    const price = parseFloat(value);
    if (!isNaN(price)) {
      onPriceChange(price);
    }
  };

  const handleQuantityIncrement = () => {
    const current = parseInt(quantityStr, 10) || 0;
    handleQuantityChange(String(current + 1));
  };

  const handleQuantityDecrement = () => {
    const current = parseInt(quantityStr, 10) || 0;
    if (current > 0) {
      handleQuantityChange(String(current - 1));
    }
  };

  const handlePriceIncrement = () => {
    const current = parseFloat(priceStr) || 0;
    handlePriceChange(String((current + 0.5).toFixed(2)));
  };

  const handlePriceDecrement = () => {
    const current = parseFloat(priceStr) || 0;
    if (current > 0) {
      handlePriceChange(String(Math.max(0, current - 0.5).toFixed(2)));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      {/* Variant Header with Image */}
      <View style={styles.variantHeader}>
        {variantImage ? (
          <Image source={{ uri: variantImage }} style={styles.variantImage} />
        ) : (
          <View style={[styles.variantImage, { backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' }]}>
            <Icon name="image-off" size={24} color="#CCC" />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.variantName, { color: theme.colors.text }]}>{variant.name}</Text>
          {Object.keys(variant.optionValues || {}).length > 0 && (
            <Text style={[styles.variantOptions, { color: theme.colors.textSecondary }]}>
              {Object.entries(variant.optionValues || {})
                .map(([key, val]) => `${key}: ${val}`)
                .join(' • ')}
            </Text>
          )}
        </View>
        {onVariantImageSelect && !readonly && (
          <TouchableOpacity onPress={onVariantImageSelect} style={styles.editImageBtn}>
            <Icon name="pencil" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Location Selector */}
      {locations.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Location</Text>
          {readonly ? (
            <View style={[styles.locationDisplay, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
              <Icon name="map-marker" size={16} color={theme.colors.textSecondary} />
              <Text style={[styles.locationDisplayText, { color: theme.colors.text }]}>
                {selectedLocation?.name || 'Select Location'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setShowLocationPicker(!showLocationPicker)}
              style={[styles.locationDropdown, { borderColor: theme.colors.border }]}
            >
              <Icon name="map-marker" size={16} color={theme.colors.textSecondary} />
              <Text style={[styles.locationDropdownText, { color: theme.colors.text }]}>
                {selectedLocation?.name || 'Select Location'}
              </Text>
              <Icon name={showLocationPicker ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}

          {showLocationPicker && locations.length > 1 && (
            <View style={[styles.locationPickerDropdown, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
              {locations.map(loc => (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => {
                    onLocationChange?.(loc.id);
                    setShowLocationPicker(false);
                  }}
                  style={[
                    styles.locationOption,
                    selectedLocationId === loc.id && [styles.locationOptionActive, { backgroundColor: '#93C822' }],
                  ]}
                >
                  <Text style={[styles.locationOptionText, { color: selectedLocationId === loc.id ? '#FFF' : theme.colors.text }]}>
                    {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Quantity and Price Row */}
      <View style={styles.section}>
        <View style={styles.inputRow}>
          {/* Quantity */}
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>Quantity</Text>
            {readonly ? (
              <View style={[styles.inputReadonly, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                <Text style={[styles.inputText, { color: theme.colors.text }]}>{quantityStr}</Text>
              </View>
            ) : (
              <View style={[styles.quantityControl, { borderColor: theme.colors.border }]}>
                <TouchableOpacity onPress={handleQuantityDecrement} style={styles.quantityBtn}>
                  <Icon name="minus" size={18} color="#666" />
                </TouchableOpacity>
                <TextInput
                  style={[styles.quantityInput, { color: theme.colors.text }]}
                  value={quantityStr}
                  onChangeText={handleQuantityChange}
                  keyboardType="number-pad"
                  editable={!readonly}
                />
                <TouchableOpacity onPress={handleQuantityIncrement} style={styles.quantityBtn}>
                  <Icon name="plus" size={18} color="#666" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Price */}
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              Price {!supportsPerLocationPricing && platformKey === 'shopify' ? '(Global)' : ''}
            </Text>
            {readonly ? (
              <View style={[styles.inputReadonly, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                <Text style={[styles.inputText, { color: theme.colors.text }]}>
                  ${parseFloat(priceStr).toFixed(2)}
                </Text>
              </View>
            ) : (
              <View style={[styles.priceControl, { borderColor: theme.colors.border }]}>
                <TouchableOpacity onPress={handlePriceDecrement} style={styles.priceBtn}>
                  <Icon name="minus" size={18} color="#666" />
                </TouchableOpacity>
                <TextInput
                  style={[styles.priceInput, { color: theme.colors.text }]}
                  value={priceStr}
                  onChangeText={handlePriceChange}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  editable={!readonly}
                />
                <TouchableOpacity onPress={handlePriceIncrement} style={styles.priceBtn}>
                  <Icon name="plus" size={18} color="#666" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  variantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  variantImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  variantName: {
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 4,
  },
  variantOptions: {
    fontSize: 12,
  },
  editImageBtn: {
    padding: 8,
    marginLeft: 8,
  },
  section: {
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  locationDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  locationDisplayText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  locationDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  locationDropdownText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  locationPickerDropdown: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  locationOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  locationOptionActive: {
    borderBottomColor: '#93C822',
  },
  locationOptionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  quantityBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityInput: {
    flex: 1,
    paddingHorizontal: 8,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  priceControl: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  priceBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  priceInput: {
    flex: 1,
    paddingHorizontal: 8,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  inputReadonly: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  inputText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default VariantInventoryEditor;

