import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type PlatformsData = Record<string, any>;

type Props = {
  platforms: PlatformsData;
  images: string[];
  onChangePlatforms: (next: PlatformsData) => void;
  onChangeImages?: (next: string[]) => void;
  onOpenFieldPanel?: (fieldKey: string) => void;
};

type Variant = {
  id: string;
  optionValues: Record<string, string>; // e.g., { Size: 'Small', Color: 'Red' }
  price?: number;
  image?: string;
  inventoryByLocation?: Record<string, { quantity: number; price?: number; image?: string }>;
};

type PlatformState = {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  weight?: number;
  weightUnit?: string;
  sku?: string;
  barcode?: string;
  images?: string[];
  // Advanced listing structures
  locations?: Array<{ id: string; name: string }>;
  locationQuantities?: Record<string, number>; // simple per-location inventory
  options?: Array<{ name: string; values: string[] }>; // e.g., [{name:'Size', values:['S','M','L']}]
  variants?: Variant[];
};

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

const ADVANCED_PLATFORMS = new Set(['shopify','square','clover']);

export default function ListingEditorForm({ platforms, images, onChangePlatforms, onChangeImages, onOpenFieldPanel }: Props) {
  const platformKeys = useMemo(() => Object.keys(platforms || {}), [platforms]);
  const [activeTab, setActiveTab] = useState<string>(platformKeys[0] || 'all');

  const canonicalKey = useMemo(() => (platformKeys.includes('shopify') ? 'shopify' : (platformKeys[0] || '')), [platformKeys]);
  const activePlatformKey = activeTab === 'all' ? canonicalKey : activeTab;
  const activeData = useMemo<PlatformState>(() => (platforms[activePlatformKey] || {}) as PlatformState, [activePlatformKey, platforms]);
  const isAdvanced = ADVANCED_PLATFORMS.has(activePlatformKey);

  const patchField = (key: string, value: any) => {
    const keyToEdit = activePlatformKey;
    const next = { ...platforms, [keyToEdit]: { ...(platforms[keyToEdit] || {}), [key]: value } };
    onChangePlatforms(next);
  };

  const patchPlatform = (updater: (prev: PlatformState) => PlatformState) => {
    const prev = (platforms[activePlatformKey] || {}) as PlatformState;
    const nextPlatform = updater(prev);
    onChangePlatforms({ ...platforms, [activePlatformKey]: nextPlatform });
  };

  // Defaults
  const defaultLocations = useMemo(() => (
    [{ id: 'loc-1', name: 'Location 1' }, { id: 'loc-2', name: 'Location 2' }]
  ), []);

  const locations = useMemo(() => (activeData.locations && activeData.locations.length ? activeData.locations : defaultLocations), [activeData.locations, defaultLocations]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(locations[0]?.id || 'loc-1');

  const ensureOptionStructure = () => {
    if (!Array.isArray(activeData.options)) {
      patchPlatform(prev => ({ ...prev, options: [{ name: 'Size', values: ['Small','Medium','Large'] }] }));
    }
  };

  const cartesian = (arrays: string[][]): string[][] => {
    return arrays.reduce<string[][]>((acc, curr) => {
      const res: string[][] = [];
      for (const a of acc) for (const b of curr) res.push([...a, b]);
      return res;
    }, [[]]);
  };

  const recomputeVariants = () => {
    const opts = (activeData.options || []).filter(o => Array.isArray(o.values) && o.values.length);
    if (!opts.length) {
      patchPlatform(prev => ({ ...prev, variants: [] }));
      return;
    }
    const names = opts.map(o => o.name);
    const vals = opts.map(o => o.values);
    const combos = cartesian(vals);
    const nextVariants: Variant[] = combos.map((combo, i) => {
      const optionValues: Record<string,string> = {};
      combo.forEach((v, idx) => optionValues[names[idx]] = v);
      const id = `${activePlatformKey}-var-${i}`;
      const existing = (activeData.variants || []).find(v => JSON.stringify(v.optionValues) === JSON.stringify(optionValues));
      return existing || { id, optionValues };
    });
    patchPlatform(prev => ({ ...prev, variants: nextVariants }));
  };

  const addOption = (name: string) => {
    patchPlatform(prev => {
      const options = Array.isArray(prev.options) ? prev.options.slice() : [];
      options.push({ name, values: [] });
      return { ...prev, options };
    });
  };

  const addOptionValue = (optName: string, value: string) => {
    patchPlatform(prev => {
      const options = (prev.options || []).map(o => o.name === optName ? { ...o, values: Array.from(new Set([...(o.values||[]), value])) } : o);
      return { ...prev, options } as PlatformState;
    });
    // Recompute variants after short delay to let state settle
    setTimeout(recomputeVariants, 0);
  };

  const setLocationQuantity = (locId: string, qty: number) => {
    patchPlatform(prev => ({ ...prev, locationQuantities: { ...(prev.locationQuantities || {}), [locId]: qty } }));
  };

  const setVariantAtLocation = (variantId: string, locId: string, field: 'quantity'|'price'|'image', value: any) => {
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => {
        if (v.id !== variantId) return v;
        const inv = { ...(v.inventoryByLocation || {}) };
        inv[locId] = { quantity: inv[locId]?.quantity || 0, price: inv[locId]?.price, image: inv[locId]?.image, [field]: value } as any;
        return { ...v, inventoryByLocation: inv };
      });
      return { ...prev, variants } as PlatformState;
    });
  };

  const pills = ['all', ...platformKeys];

  return (
    <View style={{ paddingBottom: 120 }}>
      {/* Media */}
      <View style={styles.mediaRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(images || []).map((uri, i) => (
            <View key={`${uri}-${i}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
            </View>
          ))}
          <TouchableOpacity style={[styles.thumbWrap, styles.addThumb]} onPress={() => {/* Hook up camera/gallery */}}>
            <Icon name="plus" size={22} color="#666" />
          </TouchableOpacity>
        </ScrollView>
        <Text style={styles.mediaHint}>Drag to Reorder Images</Text>
      </View>

      {/* Platform filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        {pills.map((key) => (
          <TouchableOpacity key={key} onPress={() => setActiveTab(key)} style={[styles.pill, activeTab === key && styles.pillActive]}>
            <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>{key === 'all' ? 'All' : (PLATFORM_META[key]?.label || key)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.pillDashed}>
          <Text style={styles.pillText}>+ Add Platform</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Canonical fields */}
      <View style={styles.card}>
        <Field label="Title" value={activeData.title} onChangeText={(t) => patchField('title', t)} onInfo={() => onOpenFieldPanel?.('title')} />
        <Field label="Description" value={activeData.description} multiline onChangeText={(t) => patchField('description', t)} onInfo={() => onOpenFieldPanel?.('description')} />
        <ChipsField label="Tags" valueArray={activeData.tags} onChangeArray={(arr) => patchField('tags', arr)} onInfo={() => onOpenFieldPanel?.('tags')} />
        <Field label="Price" keyboardType="decimal-pad" value={String(activeData.price ?? '')} onChangeText={(t) => patchField('price', t)} onInfo={() => onOpenFieldPanel?.('price')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Shipping Weight" keyboardType="decimal-pad" value={String(activeData.weight ?? '')} onChangeText={(t) => patchField('weight', t)} onInfo={() => onOpenFieldPanel?.('weight')} />
          </View>
          <View style={{ width: 120 }}>
            <Dropdown label="Ounces" options={["Ounces","Pounds","Grams","Kilograms"]} value={activeData.weightUnit || 'Ounces'} onChange={(v)=>patchField('weightUnit', v)} />
          </View>
        </View>
        <Field label="SKU" value={activeData.sku} onChangeText={(t) => patchField('sku', t)} onInfo={() => onOpenFieldPanel?.('sku')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Barcode" value={activeData.barcode} onChangeText={(t) => patchField('barcode', t)} onInfo={() => onOpenFieldPanel?.('barcode')} />
          </View>
          <TouchableOpacity style={styles.scanBtn} onPress={() => {/* open barcode scanner */}}>
            <Icon name="qrcode-scan" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Variants */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Variants</Text>
        {/* Existing options */}
        {(activeData.options || []).map(opt => (
          <View key={opt.name} style={{ marginTop: 10 }}>
            <Text style={styles.subtle}>{opt.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {(opt.values || []).map(v => (
                <View key={`${opt.name}-${v}`} style={styles.tagChip}><Text style={{ color: '#000' }}>{v}</Text></View>
              ))}
              {/* Quick add value */}
              <TouchableOpacity style={styles.addTagBtn} onPress={() => addOptionValue(opt.name, `Value ${((opt.values||[]).length + 1)}`)}>
                <Icon name="plus" size={16} color="#000" /><Text style={{ color: '#000', marginLeft: 6 }}>Add value</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.addOption} onPress={() => { ensureOptionStructure(); addOption('Size'); }}>
          <Text style={{ color: '#000' }}>+ Add an option</Text>
        </TouchableOpacity>
      </View>

      {/* Inventory summary by location (simple) */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Inventory</Text>
        <View style={{ marginTop: 8 }}>
          {locations.map(loc => (
            <View key={loc.id} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <Text style={{ color: '#000', fontWeight: '600' }}>{loc.name}</Text>
              <Text style={{ color: '#000', marginTop: 6 }}>Quantity:</Text>
              <TextInput
                style={styles.qtyInput}
                keyboardType="number-pad"
                value={String((activeData.locationQuantities || {})[loc.id] ?? 0)}
                onChangeText={(t)=>setLocationQuantity(loc.id, Number(t || '0'))}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Inventory by variant for selected location (advanced for Shopify/Square/Clover) */}
      {isAdvanced && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Inventory</Text>
          <View style={{ marginVertical: 8 }}>
            <TouchableOpacity style={styles.locationPill} onPress={() => {}}>
              <View style={styles.dotOnline} />
              <Text style={{ color: '#000' }}>{locations.find(l=>l.id===selectedLocationId)?.name || locations[0]?.name}</Text>
            </TouchableOpacity>
            {/* Simple dropdown menu for locations */}
            <Dropdown label={locations.find(l=>l.id===selectedLocationId)?.name || 'Select Location'} options={locations.map(l=>l.name)} value={locations.find(l=>l.id===selectedLocationId)?.name || locations[0]?.name || ''} onChange={(name)=>{
              const loc = locations.find(l=>l.name===name);
              if (loc) setSelectedLocationId(loc.id);
            }} />
          </View>
          {(activeData.variants || []).map(variant => {
            const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';
            const inv = (variant.inventoryByLocation || {})[selectedLocationId] || { quantity: 0, price: undefined };
            return (
              <View key={variant.id} style={styles.inventoryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>{variantName}</Text>
                  <Text style={{ color: '#000', marginTop: 6 }}>Quantity:</Text>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="number-pad"
                    value={String(inv.quantity ?? 0)}
                    onChangeText={(t)=>setVariantAtLocation(variant.id, selectedLocationId, 'quantity', Number(t || '0'))}
                  />
                  {isAdvanced && (
                    <>
                      <Text style={{ color: '#000', marginTop: 6 }}>Price:</Text>
                      <TextInput
                        style={styles.qtyInput}
                        keyboardType="decimal-pad"
                        value={String(inv.price ?? activeData.price ?? 0)}
                        onChangeText={(t)=>setVariantAtLocation(variant.id, selectedLocationId, 'price', Number(t || '0'))}
                      />
                    </>
                  )}
                </View>
                <TouchableOpacity style={styles.variantImgSlot} onPress={() => {
                  // For now, assign first product image as the variant image; integrate picker later
                  const candidate = (images || [])[0];
                  if (candidate) setVariantAtLocation(variant.id, selectedLocationId, 'image', candidate);
                }}>
                  <Icon name="plus" size={20} color="#888" />
                </TouchableOpacity>
              </View>
            );
          })}
          {/* Ensure variants exist if options present */}
          {Array.isArray(activeData.options) && (activeData.variants || []).length === 0 && (
            <TouchableOpacity style={styles.addOption} onPress={recomputeVariants}>
              <Text style={{ color: '#000' }}>Generate variant rows</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function Field({ label, value, onChangeText, multiline, keyboardType, onInfo }: { label: string; value?: string; onChangeText?: (t:string)=>void; multiline?: boolean; keyboardType?: any; onInfo?: ()=>void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#000" /></TouchableOpacity>
        )}
      </View>
      <TextInput
        style={[styles.input, multiline && { minHeight: 100, textAlignVertical: 'top' }]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={label}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function ChipsField({ label, valueArray, onChangeArray, onInfo }: { label: string; valueArray?: string[]; onChangeArray: (arr: string[])=>void; onInfo?: ()=>void }) {
  const [text, setText] = useState('');
  const arr = Array.isArray(valueArray) ? valueArray : [];
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#000" /></TouchableOpacity>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
        {arr.map((t, i) => (
          <View key={`${t}-${i}`} style={styles.tagChip}><Text style={{ color: '#000' }}>{t}</Text></View>
        ))}
      </View>
      <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Add tag and press +" />
      <TouchableOpacity style={styles.addTagBtn} onPress={() => { if (text.trim().length) { onChangeArray([...arr, text.trim()]); setText(''); } }}>
        <Icon name="plus" size={16} color="#000" /><Text style={{ color: '#000', marginLeft: 6 }}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}

function Dropdown({ label, options, value, onChange }:{ label: string; options: string[]; value: string; onChange: (v:string)=>void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(o=>!o)}>
        <Text style={{ color: '#000' }}>{value || label}</Text>
        <Icon name="chevron-down" size={18} color="#000" />
      </TouchableOpacity>
      {open && (
        <View style={styles.dropdownMenu}>
          {options.map(opt => (
            <TouchableOpacity key={opt} style={styles.dropdownItem} onPress={() => { onChange(opt); setOpen(false); }}>
              <Text style={{ color: '#000' }}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mediaRow: { borderBottomColor: '#E5E5E5', borderBottomWidth: 1, paddingBottom: 10, marginBottom: 10 },
  thumbWrap: { width: 86, height: 86, borderRadius: 8, overflow: 'hidden', marginRight: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  addThumb: { borderStyle: 'dashed' },
  mediaHint: { textAlign: 'center', color: '#71717A', marginTop: 6 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#E5E5E5', marginRight: 8 },
  pillActive: { backgroundColor: 'rgba(147,200,34,0.12)', borderColor: '#93C822' },
  pillText: { color: '#000' },
  pillTextActive: { fontWeight: '700' },
  pillDashed: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#E5E5E5' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 6, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  dropdown: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginTop: 6, backgroundColor: '#fff' },
  dropdownItem: { padding: 10 },
  scanBtn: { backgroundColor: '#93C822', width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  sectionTitle: { color: '#000', fontWeight: '700' },
  subtle: { color: '#71717A', marginTop: 4 },
  addOption: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'center', marginTop: 10 },
  locationPill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, marginVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotOnline: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FACC15', marginRight: 6 },
  inventoryRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  qtyInput: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, width: 100, color: '#000' },
  variantImgSlot: { width: 120, height: 120, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});


