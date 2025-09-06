import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, X, Sparkles } from 'lucide-react-native';

export type PlatformsData = Record<string, any>;

type Props = {
  platforms: PlatformsData;
  images: string[];
  onChangePlatforms: (next: PlatformsData) => void;
  onChangeImages?: (next: string[]) => void;
  onOpenFieldPanel?: (fieldKey: string) => void;
  onOpenBarcodeScanner?: (onResult: (code: string) => void) => void;
  onOpenImageCapture?: (onResult: (uris: string[]) => void) => void;
  onRegenerateField?: (platformKey: string, fieldKey: string) => void;
  onAddMissingField?: (platformKey: string) => void;
  getMissingFieldsCount?: (platformKey: string) => number;
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
  // SEO
  seoTitle?: string;
  seoDescription?: string;
  // Inventory behavior
  inventoryType?: InventoryType;
};

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

// Inventory behavior mapping
export type InventoryType = 'LOCATION_VARIANT_WITH_OPTIONS' | 'VARIANT_WITH_OPTIONS' | 'BASIC';

const DEFAULT_INVENTORY_TYPE_BY_PLATFORM: Record<string, InventoryType> = {
  shopify: 'LOCATION_VARIANT_WITH_OPTIONS',
  square: 'LOCATION_VARIANT_WITH_OPTIONS',
  clover: 'LOCATION_VARIANT_WITH_OPTIONS',
  amazon: 'VARIANT_WITH_OPTIONS',
  ebay: 'VARIANT_WITH_OPTIONS',
  facebook: 'BASIC',
  whatnot: 'BASIC',
  depop: 'BASIC',
};

export default function ListingEditorForm({ platforms, images, onChangePlatforms, onChangeImages, onOpenFieldPanel, onOpenBarcodeScanner, onOpenImageCapture, onRegenerateField, onAddMissingField, getMissingFieldsCount }: Props) {
  const platformKeys = useMemo(() => Object.keys(platforms || {}), [platforms]);
  const [activeTab, setActiveTab] = useState<string>(platformKeys[0] || 'all');
  const [showSEO, setShowSEO] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [optionEditorOpen, setOptionEditorOpen] = useState<boolean>(false);
  const [newOptionName, setNewOptionName] = useState<string>('');
  const [newOptionValues, setNewOptionValues] = useState<string[]>(['']);
  const [openImagePickerFor, setOpenImagePickerFor] = useState<string | null>(null);
  const [showPlatformPicker, setShowPlatformPicker] = useState<boolean>(false);

  const canonicalKey = useMemo(() => (platformKeys.includes('shopify') ? 'shopify' : (platformKeys[0] || '')), [platformKeys]);
  const activePlatformKey = activeTab === 'all' ? canonicalKey : activeTab;
  const activeData = useMemo<PlatformState>(() => (platforms[activePlatformKey] || {}) as PlatformState, [activePlatformKey, platforms]);
  const selectedInventoryType: InventoryType = (activeData.inventoryType || DEFAULT_INVENTORY_TYPE_BY_PLATFORM[activePlatformKey] || 'BASIC');
  const isAdvanced = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS';
  const supportsVariants = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' || selectedInventoryType === 'VARIANT_WITH_OPTIONS';

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
      const id = `${activePlatformKey}-var-${names.map((n,ix)=>`${n}:${combo[ix]}`).join('|')}`;
      const existing = (activeData.variants || []).find(v => JSON.stringify(v.optionValues) === JSON.stringify(optionValues));
      return existing || { id, optionValues };
    });
    patchPlatform(prev => ({ ...prev, variants: nextVariants }));
  };

  // Normalize options: merge duplicate names (case-insensitive), drop empties, dedupe values
  const normalizeOptions = (opts?: Array<{ name: string; values: string[] }>) => {
    const acc: Record<string, string[]> = {};
    for (const o of (opts || [])) {
      const nameRaw = (o?.name || '').trim();
      if (!nameRaw) continue;
      const key = nameRaw.toLowerCase();
      const values = Array.from(new Set((o?.values || []).map(v => (v || '').trim()).filter(Boolean)));
      if (!acc[key]) acc[key] = [];
      acc[key] = Array.from(new Set([ ...acc[key], ...values ]));
    }
    return Object.entries(acc).map(([k, values]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), values }));
  };

  useEffect(() => {
    const cleaned = normalizeOptions(activeData.options);
    if (JSON.stringify(cleaned) !== JSON.stringify(activeData.options || [])) {
      patchPlatform(prev => ({ ...prev, options: cleaned }));
    }
    // Variants should reflect any option changes
    // setTimeout to avoid double setState in same render
    setTimeout(recomputeVariants, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatformKey, JSON.stringify(activeData.options || [])]);

  // Variant editing helpers
  const setVariantOptionValue = (variantId: string, optionName: string, newValue: string) => {
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => {
        if (v.id !== variantId) return v;
        const optionValues = { ...(v.optionValues || {}) };
        optionValues[optionName] = newValue;
        return { ...v, optionValues };
      });
      return { ...prev, variants } as PlatformState;
    });
  };

  const addVariantRow = () => {
    const opts = (activeData.options || []).filter(o => Array.isArray(o.values) && o.values.length);
    if (!opts.length) {
      setOptionEditorOpen(true);
      return;
    }
    const optionValues: Record<string,string> = {};
    for (const opt of opts) {
      optionValues[opt.name] = opt.values[0];
    }
    const id = `${activePlatformKey}-var-${Date.now()}`;
    patchPlatform(prev => ({ ...prev, variants: [ ...(prev.variants || []), { id, optionValues } ] }));
  };

  const handleAddOptionValueRow = () => setNewOptionValues(prev => [...prev, '']);
  const handleChangeOptionValue = (index: number, value: string) => {
    setNewOptionValues(prev => prev.map((v,i)=> i===index ? value : v));
  };
  const handleCancelOption = () => {
    setOptionEditorOpen(false);
    setNewOptionName('');
    setNewOptionValues(['']);
  };
  const handleDoneOption = () => {
    const name = newOptionName.trim();
    const values = Array.from(new Set(newOptionValues.map(v=>v.trim()).filter(Boolean)));
    if (!name || values.length === 0) {
      // keep editor open; in production show a toast
      return;
    }
    patchPlatform(prev => {
      const options = Array.isArray(prev.options) ? prev.options.slice() : [];
      // If an option with the same name exists, replace it; else append
      const existingIndex = options.findIndex(o => o.name === name);
      if (existingIndex >= 0) {
        options[existingIndex] = { name, values };
      } else {
        options.push({ name, values });
      }
      return { ...prev, options } as PlatformState;
    });
    // recompute variants based on new options
    setTimeout(recomputeVariants, 0);
    // reset editor
    setOptionEditorOpen(false);
    setNewOptionName('');
    setNewOptionValues(['']);
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

  // Hydrate platform with generated data if missing
  const fieldsToAutoFill: Array<keyof PlatformState> = [
    'title','description','tags','price','weight','weightUnit','sku','barcode','images','options','seoTitle','seoDescription'
  ];

  const autofillMissingFromCanonical = () => {
    const base = (platforms[canonicalKey] || {}) as PlatformState;
    if (!base) return;
    patchPlatform(prev => {
      const next: PlatformState = { ...prev } as PlatformState;
      let changed = false;
      for (const key of fieldsToAutoFill) {
        const curr = (next as any)[key];
        let val = (base as any)[key];
        if ((key === 'seoTitle' || key === 'seoDescription') && val === undefined) {
          // derive from canonical title/description if not explicitly present
          val = key === 'seoTitle' ? (base as any).title : (base as any).description;
        }
        if ((curr === undefined || (Array.isArray(curr) && curr.length === 0)) && val !== undefined) {
          (next as any)[key] = Array.isArray(val) ? [...val] : val;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  useEffect(() => {
    // When switching to a platform tab, populate missing fields from canonical if possible
    autofillMissingFromCanonical();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatformKey]);

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
  // Add a couple of extra platforms for quick swap-in
  const allKnownPlatforms = Array.from(new Set([...Object.keys(PLATFORM_META), 'whatnot', 'depop']));
  const addPlatform = (platformKey: string) => {
    if (!platformKey || platformKeys.includes(platformKey)) return;
    const base = (platforms[canonicalKey] || {}) as PlatformState;
    const newData: PlatformState = {} as PlatformState;
    for (const key of fieldsToAutoFill) {
      const val = (base as any)[key];
      if (val !== undefined) (newData as any)[key] = Array.isArray(val) ? [...val] : val;
    }
    const next = { ...platforms, [platformKey]: newData } as PlatformsData;
    onChangePlatforms(next);
    setShowPlatformPicker(false);
    setActiveTab(platformKey);
    setTimeout(recomputeVariants, 0);
  };
  const removePlatform = (platformKey: string) => {
    if (!platformKey) return;
    const next = { ...platforms } as PlatformsData;
    delete (next as any)[platformKey];
    onChangePlatforms(next);
    if (activeTab === platformKey) setActiveTab('all');
  };

  return (
    <View style={{ paddingBottom: 120 }}>
      {/* Media */}
      <View style={styles.mediaRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(images || []).map((uri, i) => (
            <TouchableOpacity
              key={`${uri}-${i}`}
              style={[styles.thumbWrap, i === 0 && styles.thumbCover]}
              onPress={() => {
                const next = (images || []).slice();
                const [chosen] = next.splice(i, 1);
                next.unshift(chosen);
                onChangeImages?.(next);
              }}
            >
              <Image source={{ uri }} style={styles.thumb} />
              {i === 0 && (
                <View style={styles.coverBadge}>
                  <Icon name="star" size={14} color="#fff" />
                  <Text style={{ color: '#fff', marginLeft: 4, fontSize: 10 }}>Cover</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.thumbWrap, styles.addThumb]} onPress={async () => {
            // small chooser: camera or library
            try {
              // Simple inline menu: prefer camera if provided, else fallback to library
              // You can replace with ActionSheet if desired
              const useCameraFirst = true;
              if (useCameraFirst && onOpenImageCapture) {
                onOpenImageCapture((uris:string[])=>onChangeImages?.([...(images||[]), ...uris]));
                return;
              }
              const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== 'granted') return;
              const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.9 });
              if (!result.canceled) {
                const assets = (result as any).assets || [];
                const uris: string[] = assets.map((a:any)=>a.uri).filter(Boolean);
                if (uris.length) onChangeImages?.([...(images||[]), ...uris]);
              }
            } catch {}
          }}>
            <Icon name="plus" size={22} color="#666" />
          </TouchableOpacity>
        </ScrollView>
        <Text style={styles.mediaHint}>Tap an image to set it as the cover</Text>
      </View>

      {/* Platform filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        {pills.map((key) => (
          key === 'all' ? (
            <TouchableOpacity key={key} onPress={() => setActiveTab(key)} style={[styles.pill, activeTab === key && styles.pillActive]}>
              <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>All</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={key} onPress={() => setActiveTab(key)} style={[styles.pill, activeTab === key && styles.pillActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }] }>
              {/* X inside pill */}
              <TouchableOpacity onPress={() => removePlatform(key)} style={styles.pillClose}>
                <Icon name="close" size={12} color="#6B7280" />
              </TouchableOpacity>
              {/* Small SVG logo */}
              {(() => {
                const map: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg };
                const SVG = map[key];
                return SVG ? <SVG width={12} height={12} /> : null;
              })()}
              <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>{PLATFORM_META[key]?.label || key}</Text>
              {Array.isArray((platforms as any)[key]?.__refilled) && (platforms as any)[key].__refilled.length > 0 && (
                <View style={{ marginLeft: 6, backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: '#3f6212', fontSize: 10 }}>{(platforms as any)[key].__refilled.length} refilled</Text>
                </View>
              )}
            </TouchableOpacity>
          )
        ))}
        <TouchableOpacity style={styles.pillDashed} onPress={() => setShowPlatformPicker(v=>!v)}>
          <Text style={styles.pillText}>+ Add Platform</Text>
        </TouchableOpacity>
      </ScrollView>
      {showPlatformPicker && (
        <View style={styles.platformPickerDock}>
          <View style={styles.platformPickerCapsule}>
            <Text style={{ color: '#000', fontWeight: '700', marginBottom: 10, textAlign: 'center' }}>Add Platform</Text>
            <View style={styles.platformGrid}>
              {allKnownPlatforms.filter(k => !platformKeys.includes(k)).map(k => (
                <TouchableOpacity key={k} onPress={() => addPlatform(k)} style={styles.platformPill}>
                  {(() => { const map: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg }; const SVG = map[k]; return SVG ? <SVG width={22} height={22} /> : null; })()}
                  <Text style={{ color: '#000', marginLeft: 8 }}>{PLATFORM_META[k]?.label || k}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.btnSecondary, { alignSelf: 'center', marginTop: 10 }]} onPress={() => setShowPlatformPicker(false)}>
              <Text style={{ color: '#000' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Core fields (optimized for conversion) */}
      <View style={{paddingTop: 18, gap:9}}>
        <Field
          label="Title"
          required
          value={activeData.title}
          multiline
          onChangeText={(t) => patchField('title', t)}
          onInfo={() => onOpenFieldPanel?.('title')}
          onRegenerate={activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'title') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('title')}
        />

        <Field
          label="Description"
          value={activeData.description}
          multiline
          onChangeText={(t) => patchField('description', t)}
          onInfo={() => onOpenFieldPanel?.('description')}
          onRegenerate={activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'description') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('description')}
        />
        
        <ChipsField
          label="Tags"
          valueArray={activeData.tags}
          onChangeArray={(arr) => patchField('tags', arr)}
          onInfo={() => onOpenFieldPanel?.('tags')}
          onRegenerate={activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'tags') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('tags')}
        />
        
        <Field
          label="Price"
          required
          keyboardType="decimal-pad"
          value={String(activeData.price ?? '')}
          onChangeText={(t) => patchField('price', t)}
          onInfo={() => onOpenFieldPanel?.('price')}
          onRegenerate={activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'price') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('price')}
        />
       
       <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end',}}>
          <View style={{ flex: 1}}>
            <Field label="Shipping Weight" keyboardType="decimal-pad" value={String(activeData.weight ?? '')} onChangeText={(t) => patchField('weight', t)} onInfo={() => onOpenFieldPanel?.('weight')} />
          </View>
          <View style={{ width: 120, marginBottom: 12 }}> {/*Make this dropdown overlay ontop not push items up? actually same iwth the others*/}
            <Dropdown label="Ounces" options={["Ounces","Pounds","Grams","Kilograms"]} value={activeData.weightUnit || 'Ounces'} onChange={(v)=>patchField('weightUnit', v)} />
          </View>
        </View>

        <Field
          label="SKU"
          required
          value={activeData.sku}
          onChangeText={(t) => patchField('sku', t)}
          onInfo={() => onOpenFieldPanel?.('sku')}
          onRegenerate={activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'sku') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('sku')}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Barcode" value={activeData.barcode} onChangeText={(t) => patchField('barcode', t)} onInfo={() => onOpenFieldPanel?.('barcode')} />
          </View>
          <TouchableOpacity style={styles.scanBtn} onPress={() => { (onOpenBarcodeScanner || (()=>{}))((code: string)=>patchField('barcode', code)); }}>
            <Icon name="qrcode-scan" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        
        
      </View>


      {/* Variants: only for platforms that support variants */}
      {supportsVariants && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Variants</Text>
          {/* Inline options wizard / summary */}
          {optionEditorOpen ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.fieldLabel}>Option Name</Text>
              <TextInput
                style={styles.input}
                value={newOptionName}
                onChangeText={setNewOptionName}
                placeholder="eg: Size"
              />
              <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Option Values</Text>
              {newOptionValues.map((v, idx) => (
                <TextInput
                  key={`opt-val-${idx}`}
                  style={[styles.input, { marginTop: 6 }]}
                  value={v}
                  onChangeText={(t)=>handleChangeOptionValue(idx, t)}
                  placeholder={idx === 0 ? 'eg: Small' : 'eg: Medium'}
                />
              ))}
              <TouchableOpacity style={styles.addInline} onPress={handleAddOptionValueRow}>
                <Icon name="plus" size={16} color="#000" />
                <Text style={{ color: '#000', marginLeft: 6 }}>Add another option</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <TouchableOpacity style={styles.btnSecondary} onPress={handleCancelOption}>
                  <Text style={{ color: '#000' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnPrimary} onPress={handleDoneOption}>
                  <Text style={{ color: '#fff' }}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {((activeData.options || []).filter(o => (o.values || []).length > 0)).length > 0 && (
                (activeData.options || []).filter(o => (o.values || []).length > 0).map((opt, idx) => (
                  <View key={`${opt.name}-${idx}`} style={styles.optionSummaryCard}>
                    <Text style={styles.subtle}>{opt.name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {(opt.values || []).map(v => (
                        <View key={`${opt.name}-${v}`} style={[styles.optionChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                          <TouchableOpacity onPress={() => {
                            patchPlatform(prev => {
                              const options = (prev.options || []).map(o => o.name === opt.name ? { ...o, values: (o.values || []).filter(val => val !== v) } : o);
                              return { ...prev, options } as PlatformState;
                            });
                          }}>
                            <Icon name="close" size={10} color="#6B7280" />
                          </TouchableOpacity>
                          <Text style={{ color: '#000' }}>{v}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.addOption} onPress={() => { setNewOptionName(''); setNewOptionValues(['']); setOptionEditorOpen(true); }}>
                <Icon name="plus" size={18} color="#71717A" />
                <Text style={{ color: '#71717A', marginLeft: 8 }}>Add an option</Text>
              </TouchableOpacity>
            </>
          )}

        
        </View>
      )}

      {/* Inventory summary (auto-decided per platform) */}
      <View style={styles.darkerCard}>
        <View style={{ marginVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Text style={styles.sectionTitle}>Inventory</Text>
            {/* Locations only for LOCATION_VARIANT_WITH_OPTIONS; NEVER show for VARIANT_WITH_OPTIONS or BASIC */}
            {selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && (
              <Dropdown label={locations.find(l=>l.id===selectedLocationId)?.name || 'Select Location'} options={locations.map(l=>l.name)} value={locations.find(l=>l.id===selectedLocationId)?.name || locations[0]?.name || ''} onChange={(name)=>{
                const loc = locations.find(l=>l.name===name);
                if (loc) setSelectedLocationId(loc.id);
              }} />
            )}
          </View>
          {supportsVariants ? (
          (activeData.variants || []).map((variant, variantIdx) => {
            const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';
            const invKey = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' ? selectedLocationId : 'default';
            const inv = (variant.inventoryByLocation || {})[invKey] || { quantity: 0, price: undefined };
            return (
              <View key={`${variant.id}-${variantIdx}`} style={styles.inventoryRow}>
                <View style={{ flexDirection: "column", gap: 12, alignSelf: 'flex-start'}}>
                  <Text style={{backgroundColor: '#F8F9FB',alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, color: '#000', fontWeight: '600'}}>{variantName}</Text>
                  <View style={{flexDirection: 'row', justifyContent:'flex-end', gap: 9, alignItems: 'center', alignSelf: 'flex-end'}}>
                    <Text style={{ color: '#000' }}>Quantity:</Text>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="number-pad"
                      value={String(inv.quantity ?? 0)}
                      onChangeText={(t)=>setVariantAtLocation(variant.id, invKey, 'quantity', Number(t || '0'))}
                    />
                  </View>
                  <View style={{flexDirection: 'row', justifyContent:'flex-end', gap: 9, alignItems: 'center', alignSelf: 'flex-end'}}>
                    <Text style={{ color: '#000' }}>Price:</Text>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="decimal-pad"
                      value={String(inv.price ?? activeData.price ?? 0)}
                      onChangeText={(t)=>setVariantAtLocation(variant.id, invKey, 'price', Number(t || '0'))}
                    />
                  </View>
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
          })) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#000' }}>Quantity:</Text>
              <TextInput
                style={styles.qtyInput}
                keyboardType="number-pad"
                value={String((activeData.locationQuantities || {})['default'] ?? 0)}
                onChangeText={(t)=>setLocationQuantity('default', Number(t || '0'))}
              />
            </View>
          )}
        
      </View>
      {/* SEO basic toggle */}
        <TouchableOpacity style={styles.toggleRow} onPress={() => setShowSEO(v=>!v)}>
          <Icon name={showSEO ? 'chevron-down' : 'chevron-right'} size={18} color="#000" />
          <Text style={styles.sectionTitle}>SEO</Text>
        </TouchableOpacity>
        {showSEO && (
          <View style={styles.card}>
            <Field label="SEO Title" value={(activeData as any).seoTitle} onChangeText={(t)=>patchField('seoTitle', t)} onInfo={() => onOpenFieldPanel?.('seoTitle')} />
            <Field label="SEO Description" value={(activeData as any).seoDescription} multiline onChangeText={(t)=>patchField('seoDescription', t)} onInfo={() => onOpenFieldPanel?.('seoDescription')} />
          </View>
        )}

      {/* Dynamic Additional Fields - render any fields not covered by standard form */}
      {activeTab !== 'all' && (() => {
        const standardFields = new Set([
          'title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode',
          'images', 'options', 'variants', 'locations', 'locationQuantities', 'seoTitle', 'seoDescription',
          '__refilled', '_rawResponse', '_parseError', '_extractedJson' // Exclude internal fields
        ]);
        
        const additionalFields = Object.entries(activeData || {})
          .filter(([key, value]) => 
            !standardFields.has(key) && 
            value !== undefined && 
            value !== null &&
            !key.startsWith('_') // Skip internal fields
          );
        
        if (additionalFields.length === 0) return null;
        
        return (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Additional Fields</Text>
            <Text style={styles.subtle}>Fields automatically detected from AI response</Text>
            {additionalFields.map(([key, value]) => {
              const isArray = Array.isArray(value);
              const isObject = typeof value === 'object' && !isArray;
              const displayValue = isObject ? JSON.stringify(value, null, 2) : 
                                  isArray ? value.join(', ') : String(value);
              
              return (
                <View key={key} style={{ marginTop: 12 }}>
                  {isArray ? (
                    <ChipsField
                      label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                      valueArray={value}
                      onChangeArray={(arr) => patchField(key, arr)}
                      onInfo={() => onOpenFieldPanel?.(key)}
                      onRegenerate={onRegenerateField ? () => onRegenerateField(activePlatformKey, key) : undefined}
                      refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes(key)}
                    />
                  ) : (
                    <Field
                      label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                      value={displayValue}
                      multiline={isObject || displayValue.length > 50}
                      onChangeText={(t) => {
                        // Try to parse back to original type
                        if (isObject) {
                          try {
                            patchField(key, JSON.parse(t));
                          } catch {
                            patchField(key, t); // Fallback to string
                          }
                        } else if (typeof value === 'number') {
                          patchField(key, Number(t) || 0);
                        } else if (typeof value === 'boolean') {
                          patchField(key, t.toLowerCase() === 'true');
                        } else {
                          patchField(key, t);
                        }
                      }}
                      onInfo={() => onOpenFieldPanel?.(key)}
                      onRegenerate={onRegenerateField ? () => onRegenerateField(activePlatformKey, key) : undefined}
                      refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes(key)}
                    />
                  )}
                </View>
              );
            })}
          </View>
        );
      })()}

      {/* Add Missing Field Button for current platform */}
      {activeTab !== 'all' && onAddMissingField && (
        <TouchableOpacity 
          style={styles.addMissingFieldButton} 
          onPress={() => onAddMissingField(activePlatformKey)}
        >
          <Icon name="plus" size={18} color="#71717A" />
          <Text style={styles.addMissingFieldText}>
            Add Missing Field
            {getMissingFieldsCount && getMissingFieldsCount(activePlatformKey) > 0 && (
              <Text style={{ color: '#ef4444' }}> ({getMissingFieldsCount(activePlatformKey)} missing)</Text>
            )}
          </Text>
        </TouchableOpacity>
      )}
      
    </View>
  );
}

function Field({ label, value, onChangeText, multiline, keyboardType, onInfo, required, onRegenerate, refilled }: { label: string; value?: string; onChangeText?: (t:string)=>void; multiline?: boolean; keyboardType?: any; onInfo?: ()=>void; required?: boolean; onRegenerate?: ()=>void; refilled?: boolean }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 }}>
          <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#ef4444' }}> *</Text> : null}</Text>
          {refilled ? (
            <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
            </View>
          ) : null}
          {!!onRegenerate && (
            <TouchableOpacity onPress={onRegenerate} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
              <Sparkles size={14} color={'#000'} />
            </TouchableOpacity>
          )}
        </View>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
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

function ChipsField({ label, valueArray, onChangeArray, onInfo, onRegenerate, refilled }: { label: string; valueArray?: string[]; onChangeArray: (arr: string[])=>void; onInfo?: ()=>void; onRegenerate?: ()=>void; refilled?: boolean }) {
  const [text, setText] = useState('');
  const arr = Array.isArray(valueArray) ? valueArray : [];
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {refilled ? (
            <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
            </View>
          ) : null}
          {!!onRegenerate && (
          
            <TouchableOpacity onPress={onRegenerate} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
              <Sparkles size={14} color={'#000'} />
            </TouchableOpacity>
            

          )}
        </View>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
        )}
      </View>
      
      <View style={{flexDirection: 'row', gap: 10}}>
        <TextInput style={{borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000', minWidth: 315 }} value={text} onChangeText={setText} placeholder="Add tag and press + Add" />
        <TouchableOpacity style={styles.addTagBtn} onPress={() => { if (text.trim().length) { onChangeArray([...arr, text.trim()]); setText(''); } }}>
          <Icon name="plus" size={16} color="#000" /><Text style={{ color: '#000', marginLeft: 6 }}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
        {arr.map((t, i) => (
          <View key={`${t}-${i}`} style={[styles.tagChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            <TouchableOpacity onPress={() => onChangeArray(arr.filter((_, idx) => idx !== i))}>
              <Icon name="close" size={10} color="#6B7280" />
            </TouchableOpacity>
            {/* Small platform logo placeholder space for tags (if needed in future) */}
            <Text style={{ color: '#000' }}>{t}</Text>
          </View>
        ))}
      </View>
      
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
  mediaRow: { borderBottomColor: '#E5E5E5', borderBottomWidth: 1, paddingBottom: 10, marginBottom: 10, gap: 8 },
  thumbWrap: { width: 86, height: 86, borderRadius: 8, overflow: 'hidden', marginRight: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  addThumb: { borderStyle: 'dashed' },
  thumbCover: { borderColor: '#93C822', borderWidth: 2 },
  coverBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center' },
  mediaHint: { textAlign: 'center', color: '#71717A', marginTop: 6 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#E5E5E5', marginRight: 8 },
  pillActive: { backgroundColor: 'rgba(147,200,34,0.12)', borderColor: '#93C822' },
  pillText: { color: '#000' },
  pillTextActive: { fontWeight: '700' },
  pillDashed: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#E5E5E5' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  darkerCard: { borderWidth: 1, backgroundColor: '#F8F9FB', borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  optionChip: { backgroundColor: '#E5E5E5', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  dropdown: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginTop: 6 },
  dropdownItem: { padding: 10 },
  scanBtn: { backgroundColor: '#93C822', width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: -9 },
  sectionTitle: { color: '#000', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  subtle: { color: '#71717A', marginTop: 4 },
  addOption: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 12, alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  addInline: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  locationPill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, marginVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotOnline: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FACC15', marginRight: 6 },
  inventoryRow: { justifyContent: 'space-between', backgroundColor: 'white', flexDirection: 'row', gap: 24, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'flex-end', borderWidth: 1, borderRadius: 6, marginBottom: 12, borderColor: '#D9D9D9' },
  qtyInput: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, width: 100, color: '#000' },
  variantImgSlot: { width: 120, height: 120, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E5E5E5', borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  btnSecondary: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#93C822', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  optionCard: { marginTop: 10, backgroundColor: '#fff' },
  optionSummaryCard: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#fff' },
  platformPickerModal: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  platformPickerCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '90%' },
  platformGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pillClose: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#EFEFEF', alignItems: 'center', justifyContent: 'center' },
  // Docked platform picker similar to scanner capsule
  platformPickerDock: { position: 'absolute', top: 6, left: 24, right: 24, zIndex: 5000 },
  platformPickerCapsule: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#E5E5E5', padding: 12 },
  platformPill: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, margin: 6, flexDirection: 'row', alignItems: 'center' },
  // Add Missing Field Button
  addMissingFieldButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderStyle: 'dashed', 
    borderColor: '#71717A', 
    marginTop: 16,
    gap: 8
  },
  addMissingFieldText: { 
    color: '#71717A', 
    fontSize: 14, 
    fontWeight: '600' 
  },
});


