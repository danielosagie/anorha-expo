import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type PlatformsData = Record<string, any>;

type Props = {
  mode?: 'product' | 'generate';
  data: PlatformsData; // e.g. { shopify: {...}, ebay: {...} }
  initialTab?: string;
  title?: string;
  onOpenFieldPanel?: (fieldKey: string) => void;
};

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

/**
 * Simple, readable details viewer/editor surface for generated platform data.
 * Renders tabs for each platform present in `data`. Only shows fields that exist.
 */
export default function ProductDetailsForm({ mode = 'generate', data, initialTab, title, onOpenFieldPanel }: Props) {
  const platformKeys = useMemo(() => Object.keys(data || {}), [data]);
  const defaultTab = useMemo(() => initialTab && data[initialTab] ? initialTab : (platformKeys.includes('shopify') ? 'shopify' : platformKeys[0]), [initialTab, platformKeys, data]);
  const [active, setActive] = useState<string | undefined>(defaultTab);

  const current = active ? data[active] : undefined;

  const renderField = (label: string, value: any, key?: string) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
    return (
      <View style={styles.fieldRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {!!onOpenFieldPanel && !!key && (
            <TouchableOpacity onPress={() => onOpenFieldPanel(key)}>
              <Icon name="information-outline" size={18} color="#000" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.fieldValue}>{String(value)}</Text>
      </View>
    );
  };

  if (!platformKeys.length) {
    return (
      <View style={styles.card}> 
        <Text style={styles.heading}>No platform data</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {title ? <Text style={styles.heading}>{title}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }}>
        {platformKeys.map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => setActive(key)}
            style={[styles.tab, active === key && styles.tabActive]}
          >
            <Icon name={PLATFORM_META[key]?.icon || 'store'} size={18} color={active === key ? '#000' : '#666'} />
            <Text style={[styles.tabText, active === key && styles.tabTextActive]}>
              {PLATFORM_META[key]?.label || key}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.card}>
        {!!current && (
          <>
            {renderField('Title', current.title, 'title')}
            {renderField('Price', current.price, 'price')}
            {renderField('Description', current.description, 'description')}
            {renderField('Tags', Array.isArray(current.tags) ? current.tags.join(', ') : current.tags, 'tags')}
            {renderField('Brand', current.brand, 'brand')}
            {renderField('Condition', current.condition, 'condition')}
            {renderField('SKU', current.sku, 'sku')}
            {renderField('Barcode', current.barcode, 'barcode')}
            {renderField('Weight', current.weight, 'weight')}
            {renderField('Weight Unit', current.weightUnit, 'weightUnit')}
            {renderField('Product Type', current.productType, 'productType')}
            {renderField('Vendor', current.vendor, 'vendor')}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: '#000', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabActive: { backgroundColor: 'rgba(147,200,34,0.12)', borderColor: '#93C822' },
  tabText: { color: '#666' },
  tabTextActive: { color: '#000', fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12 },
  fieldRow: { marginBottom: 8 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 2, fontSize: 12, textTransform: 'uppercase' },
  fieldValue: { color: '#000' },
});


