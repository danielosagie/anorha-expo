import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import {
  fetchPlatformOverrides,
  savePlatformOverride,
} from '../../lib/platformOptions';
import { normalizeStoredPricingResearch } from '../../lib/storedPricingResearch';
import { useToast } from '../../context/ToastContext';
import {
  ALL_CHANNELS_SCOPE,
  BASE_PRICE_TARGET,
  copyVariantPriceToAll,
  createScopedPriceBook,
  getScopedPrice,
  isPositivePrice,
  normalizePriceInput,
  priceText,
  setScopedPrice,
  type ScopedPriceBook,
} from '../../features/generation/generatePriceScope';
import { AppMenuSelect } from '../ui/AppMenuSelect';
import { PricingGuidanceCard } from '../pricing/PricingGuidanceCard';
import FieldSheet from './FieldSheet';

export type GeneratePriceChannel = {
  id: string;
  connectionId?: string;
  label: string;
  platformKey: string;
};

type VariantTarget = {
  id?: string;
  label: string;
  target: string;
};

type PendingOverride = {
  channel: GeneratePriceChannel;
  target: VariantTarget;
  value: string;
};

export type GeneratePriceFieldSheetProps = {
  visible: boolean;
  platforms: Record<string, any>;
  canonicalKey: string;
  channels: GeneratePriceChannel[];
  productId?: string;
  sessionKey?: string;
  canonicalVariantId?: string;
  storedPricingResearch?: unknown;
  onChangePlatforms: (next: Record<string, any>) => void;
  onClose: () => void;
};

const variantId = (variant: any): string | undefined => {
  const value = variant?.id ?? variant?.Id;
  return value === null || value === undefined || value === '' ? undefined : String(value);
};

const isBaseVariant = (variant: any): boolean => (
  String(variant?.variantType ?? variant?.VariantType ?? '').toLowerCase() === 'base'
);

const variantLabel = (variant: any, index: number): string => {
  const optionValues = variant?.optionValues && typeof variant.optionValues === 'object'
    ? Object.values(variant.optionValues).filter(Boolean).map(String)
    : [variant?.option1_value, variant?.option2_value, variant?.option3_value].filter(Boolean).map(String);
  return optionValues.join(' / ')
    || String(variant?.title ?? variant?.Title ?? variant?.name ?? variant?.sku ?? variant?.Sku ?? `Variant ${index + 1}`);
};

const variantTarget = (variant: any, index: number): VariantTarget => {
  const id = variantId(variant);
  const optionKey = variant?.optionValues && typeof variant.optionValues === 'object'
    ? JSON.stringify(variant.optionValues)
    : '';
  return {
    id,
    label: variantLabel(variant, index),
    target: `variant:${optionKey || id || index}`,
  };
};

export default function GeneratePriceFieldSheet({
  visible,
  platforms,
  canonicalKey,
  channels,
  productId,
  sessionKey,
  canonicalVariantId,
  storedPricingResearch,
  onChangePlatforms,
  onClose,
}: GeneratePriceFieldSheetProps) {
  const { showToast } = useToast();
  const platformsRef = useRef(platforms);
  platformsRef.current = platforms;
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const dirtyOverridesRef = useRef(new Set<string>());
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingSavesRef = useRef(new Map<string, PendingOverride>());
  const saveOverrideRef = useRef<(pending: PendingOverride) => void>(() => undefined);

  const canonical = platforms[canonicalKey] || {};
  const sourceVariants = useMemo<any[]>(() => (
    Array.isArray(canonical.variants)
      ? canonical.variants.filter((variant: any) => !isBaseVariant(variant))
      : []
  ), [canonical.variants]);
  const targets = useMemo<VariantTarget[]>(
    () => sourceVariants.map(variantTarget),
    [sourceVariants],
  );
  const usesVariantRows = targets.length > 1;
  const singleVariant = targets.length === 1 ? targets[0] : undefined;
  const singleVariantData = singleVariant
    ? sourceVariants.find((variant: any, index: number) => variantTarget(variant, index).target === singleVariant.target)
    : undefined;

  const allPrices = useMemo<Record<string, unknown>>(() => {
    if (!usesVariantRows) {
      return {
        [BASE_PRICE_TARGET]: singleVariantData?.price ?? singleVariantData?.Price ?? canonical.price,
      };
    }
    return Object.fromEntries(targets.map((target, index) => [
      target.target,
      sourceVariants[index]?.price ?? sourceVariants[index]?.Price,
    ]));
  }, [canonical.price, singleVariantData?.Price, singleVariantData?.price, sourceVariants, targets, usesVariantRows]);
  const allPricesSignature = JSON.stringify(allPrices);
  const editorIdentity = sessionKey
    || `${productId || ''}:${targets.map((target) => target.target).join('|')}`;
  const lastEditorIdentityRef = useRef(editorIdentity);
  const [book, setBook] = useState<ScopedPriceBook>(() => createScopedPriceBook(allPrices));
  const bookRef = useRef(book);
  bookRef.current = book;
  const [scope, setScope] = useState<string>(ALL_CHANNELS_SCOPE);
  const [lastEditedTarget, setLastEditedTarget] = useState<string | null>(null);

  useEffect(() => {
    if (lastEditorIdentityRef.current !== editorIdentity) {
      lastEditorIdentityRef.current = editorIdentity;
      dirtyOverridesRef.current.clear();
      setScope(ALL_CHANNELS_SCOPE);
      setLastEditedTarget(null);
      setBook(createScopedPriceBook(allPrices));
      return;
    }
    setBook((current) => ({ ...current, all: createScopedPriceBook(allPrices).all }));
    // The signature is the stable dependency. The object is rebuilt from current props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPricesSignature, editorIdentity]);

  useEffect(() => {
    if (scope === ALL_CHANNELS_SCOPE) return;
    if (!channels.some((channel) => channel.id === scope)) setScope(ALL_CHANNELS_SCOPE);
  }, [channels, scope]);

  const optionRows = useMemo(() => [
    { label: 'All channels', value: ALL_CHANNELS_SCOPE },
    ...channels.map((channel) => ({ label: channel.label, value: channel.id })),
  ], [channels]);

  const targetForSave = useCallback((targetKey: string): VariantTarget => {
    if (targetKey !== BASE_PRICE_TARGET) {
      return targets.find((target) => target.target === targetKey)
        || { target: targetKey, label: 'Variant' };
    }
    return {
      target: BASE_PRICE_TARGET,
      label: 'Price',
      id: singleVariant?.id || canonicalVariantId,
    };
  }, [canonicalVariantId, singleVariant?.id, targets]);

  const saveOverride = useCallback(async (pending: PendingOverride) => {
    const connectionId = pending.channel.connectionId;
    const targetVariantId = pending.target.id;
    if (!productId || !connectionId || !targetVariantId) return;
    const numericPrice = isPositivePrice(pending.value) ? Number(pending.value) : null;
    if (pending.value.length > 0 && numericPrice === null) return;
    try {
      const result = await savePlatformOverride(productId, targetVariantId, connectionId, { price: numericPrice });
      if (result.outcome === 'not_saved') {
        showToast({ title: `${pending.channel.label} price not saved`, tone: 'danger' });
      } else if (result.outcome === 'pending') {
        showToast({ title: 'Saved, sync pending', tone: 'neutral' });
      } else if (result.outcome === 'push_failed') {
        showToast({ title: 'Saved, channel not synced', tone: 'warn' });
      }
    } catch {
      showToast({ title: `${pending.channel.label} price not saved`, tone: 'danger' });
    }
  }, [productId, showToast]);
  saveOverrideRef.current = (pending) => { void saveOverride(pending); };

  const flushPendingOverride = useCallback((saveKey: string) => {
    const timer = saveTimersRef.current.get(saveKey);
    if (timer) clearTimeout(timer);
    saveTimersRef.current.delete(saveKey);
    const pending = pendingSavesRef.current.get(saveKey);
    if (!pending) return;
    pendingSavesRef.current.delete(saveKey);
    saveOverrideRef.current(pending);
  }, []);

  const queueOverrideSave = useCallback((channel: GeneratePriceChannel, targetKey: string, value: string) => {
    const target = targetForSave(targetKey);
    if (!channel.connectionId || !target.id || !productId) return;
    const saveKey = `${channel.connectionId}:${target.id}`;
    const existing = saveTimersRef.current.get(saveKey);
    if (existing) clearTimeout(existing);
    pendingSavesRef.current.set(saveKey, { channel, target, value });
    saveTimersRef.current.set(saveKey, setTimeout(() => flushPendingOverride(saveKey), 650));
  }, [flushPendingOverride, productId, targetForSave]);

  const loadTargets = useMemo(() => {
    if (usesVariantRows) return targets.filter((target) => !!target.id);
    const target = targetForSave(BASE_PRICE_TARGET);
    return target.id ? [target] : [];
  }, [targetForSave, targets, usesVariantRows]);
  const channelSignature = channels
    .map((channel) => `${channel.id}:${channel.connectionId || ''}`)
    .join('|');
  const loadSignature = `${productId || ''}:${loadTargets.map((target) => `${target.target}:${target.id}`).join('|')}:${channelSignature}`;

  useEffect(() => {
    if (!productId) return;
    for (const channel of channels) {
      const values = bookRef.current.channelOverrides[channel.id] || {};
      for (const [target, value] of Object.entries(values)) {
        if (!dirtyOverridesRef.current.has(`${channel.id}:${target}`)) continue;
        queueOverrideSave(channel, target, value);
      }
    }
  }, [channels, loadSignature, productId, queueOverrideSave]);

  const flushAllPending = useCallback(() => {
    Array.from(pendingSavesRef.current.keys()).forEach(flushPendingOverride);
  }, [flushPendingOverride]);

  useEffect(() => () => {
    Array.from(saveTimersRef.current.values()).forEach(clearTimeout);
    saveTimersRef.current.clear();
    const pending = Array.from(pendingSavesRef.current.values());
    pendingSavesRef.current.clear();
    pending.forEach((entry) => saveOverrideRef.current(entry));
  }, []);

  useEffect(() => {
    if (!productId || loadTargets.length === 0) return;
    let active = true;
    void Promise.all(loadTargets.map(async (target) => ({
      target,
      entries: await fetchPlatformOverrides(productId, target.id!),
    }))).then((results) => {
      if (!active) return;
      setBook((current) => {
        let next = current;
        for (const { target, entries } of results) {
          for (const entry of entries || []) {
            const channel = channels.find((candidate) => candidate.connectionId === entry.connectionId);
            const value = priceText(entry.overrides?.price);
            if (!channel || !value) continue;
            const dirtyKey = `${channel.id}:${target.target}`;
            if (dirtyOverridesRef.current.has(dirtyKey)) continue;
            next = setScopedPrice(next, channel.id, target.target, value);
          }
        }
        return next;
      });
    }).catch(() => undefined);
    return () => { active = false; };
    // Channel labels do not change the fetched price values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSignature, productId]);

  const patchCanonicalPrices = useCallback((targetKeys: string[], value: string) => {
    const currentPlatforms = platformsRef.current;
    const targetSet = new Set(targetKeys);
    const next: Record<string, any> = {};
    for (const [platformKey, platformData] of Object.entries(currentPlatforms)) {
      const patch: Record<string, any> = {};
      if (!usesVariantRows && targetSet.has(BASE_PRICE_TARGET)) patch.price = value;
      if (Array.isArray(platformData?.variants) && platformData.variants.length > 0) {
        let changed = false;
        const variants = platformData.variants.map((variant: any, index: number) => {
          const target = usesVariantRows ? variantTarget(variant, index).target : BASE_PRICE_TARGET;
          if (!targetSet.has(target)) return variant;
          changed = true;
          return { ...variant, price: value };
        });
        if (changed) patch.variants = variants;
      }
      if (Object.keys(patch).length > 0) next[platformKey] = patch;
    }
    if (Object.keys(next).length > 0) onChangePlatforms(next);
  }, [onChangePlatforms, usesVariantRows]);

  const changePrice = useCallback((target: string, rawValue: string) => {
    const value = normalizePriceInput(rawValue);
    if (value === null) return;
    setBook((current) => setScopedPrice(current, scope, target, value));
    setLastEditedTarget(target);
    if (scope === ALL_CHANNELS_SCOPE) {
      patchCanonicalPrices([target], value);
      return;
    }
    dirtyOverridesRef.current.add(`${scope}:${target}`);
    const channel = channels.find((candidate) => candidate.id === scope);
    if (channel) queueOverrideSave(channel, target, value);
  }, [channels, patchCanonicalPrices, queueOverrideSave, scope]);

  const blurPrice = useCallback((target: string) => {
    if (scope === ALL_CHANNELS_SCOPE) return;
    const channel = channels.find((candidate) => candidate.id === scope);
    const targetInfo = targetForSave(target);
    if (!channel?.connectionId || !targetInfo.id) return;
    flushPendingOverride(`${channel.connectionId}:${targetInfo.id}`);
  }, [channels, flushPendingOverride, scope, targetForSave]);

  const copyToAll = useCallback(() => {
    if (!lastEditedTarget) return;
    const value = getScopedPrice(book, scope, lastEditedTarget);
    if (!isPositivePrice(value)) return;
    const targetKeys = targets.map((target) => target.target);
    setBook((current) => copyVariantPriceToAll(current, scope, lastEditedTarget, targetKeys));
    if (scope === ALL_CHANNELS_SCOPE) {
      patchCanonicalPrices(targetKeys, value);
      return;
    }
    const channel = channels.find((candidate) => candidate.id === scope);
    if (!channel) return;
    targetKeys.forEach((target) => {
      dirtyOverridesRef.current.add(`${scope}:${target}`);
      queueOverrideSave(channel, target, value);
    });
  }, [book, channels, lastEditedTarget, patchCanonicalPrices, queueOverrideSave, scope, targets]);

  const pricingResearch = useMemo(
    () => normalizeStoredPricingResearch(storedPricingResearch),
    [storedPricingResearch],
  );
  const selectedCopyPrice = lastEditedTarget
    ? getScopedPrice(book, scope, lastEditedTarget)
    : '';

  const scopeSelect = (
    <AppMenuSelect
      value={scope}
      options={optionRows}
      onChange={setScope}
      menuWidth={210}
      style={styles.scopeSelect}
    />
  );

  const close = () => {
    flushAllPending();
    onClose();
  };

  return (
    <FieldSheet
      visible={visible}
      title="Price"
      headerAccessory={usesVariantRows ? (
        <View style={styles.countPill}>
          <Text style={styles.countText}>{targets.length} variants</Text>
        </View>
      ) : scopeSelect}
      onClose={close}
      onSave={close}
      saveLabel="Done"
      minHeightPct={88}
      maxHeightPct={94}
    >
      <View style={styles.researchPanel}>
        <PricingGuidanceCard
          headers="none"
          pricing={pricingResearch || undefined}
          showRange
          showDistribution={false}
          maxComps={3}
          showCompMeta={false}
          emptyLabel="No sold comps"
        />
      </View>
      {usesVariantRows ? (
        <View style={styles.variantBody}>
          <View style={styles.variantScopeRow}>{scopeSelect}</View>
          <View style={styles.variantList}>
            {targets.map((target, index) => (
              <Pressable
                key={target.target}
                onPress={() => {
                  setLastEditedTarget(target.target);
                  inputRefs.current[target.target]?.focus();
                }}
                style={({ pressed }) => [
                  styles.variantRow,
                  index < targets.length - 1 && styles.variantDivider,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.variantLabel} numberOfLines={1}>{target.label}</Text>
                <View style={styles.variantPriceWrap}>
                  <Text style={styles.variantCurrency}>$</Text>
                  <TextInput
                    ref={(node) => { inputRefs.current[target.target] = node; }}
                    value={getScopedPrice(book, scope, target.target)}
                    onChangeText={(value) => changePrice(target.target, value)}
                    onFocus={() => setLastEditedTarget(target.target)}
                    onBlur={() => blurPrice(target.target)}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={CHAT_COLORS.faint}
                    selectTextOnFocus
                    style={styles.variantInput}
                    accessibilityLabel={`${target.label} price`}
                  />
                </View>
              </Pressable>
            ))}
          </View>
          {lastEditedTarget ? (
            <Pressable
              onPress={copyToAll}
              disabled={!isPositivePrice(selectedCopyPrice)}
              style={({ pressed }) => [
                styles.copyButton,
                !isPositivePrice(selectedCopyPrice) && styles.copyButtonDisabled,
                pressed && isPositivePrice(selectedCopyPrice) && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isPositivePrice(selectedCopyPrice) }}
            >
              <Icon name="content-copy" size={15} color={CHAT_COLORS.brandDeep} />
              <Text style={styles.copyText}>Copy to all</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.priceInputWrap}>
          <Text style={styles.priceCurrency}>$</Text>
          <TextInput
            style={styles.priceInput}
            value={getScopedPrice(book, scope, BASE_PRICE_TARGET)}
            onChangeText={(value) => changePrice(BASE_PRICE_TARGET, value)}
            onBlur={() => blurPrice(BASE_PRICE_TARGET)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={CHAT_COLORS.faint}
            selectTextOnFocus
            accessibilityLabel="Price"
          />
        </View>
      )}
    </FieldSheet>
  );
}

const styles = StyleSheet.create({
  scopeSelect: {
    width: 154,
    height: 34,
    minHeight: 34,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 11,
    paddingVertical: 0,
    backgroundColor: CHAT_COLORS.bubble,
  },
  countPill: {
    minHeight: 30,
    justifyContent: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    backgroundColor: CHAT_COLORS.bubble,
  },
  countText: {
    color: CHAT_COLORS.dim,
    fontSize: 12,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
  },
  researchPanel: {
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: CHAT_COLORS.white,
  },
  priceInputWrap: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: CHAT_COLORS.brand,
    borderRadius: 16,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
  },
  priceCurrency: {
    marginRight: 6,
    color: CHAT_COLORS.dim,
    fontSize: 22,
    fontFamily: CHAT_FONT.medium,
    fontWeight: '500',
  },
  priceInput: {
    flex: 1,
    padding: 0,
    color: CHAT_COLORS.ink,
    fontSize: 30,
    fontFamily: CHAT_FONT.bold,
    fontWeight: '700',
  },
  variantBody: { gap: 12 },
  variantScopeRow: { alignItems: 'flex-end' },
  variantList: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: CHAT_COLORS.white,
  },
  variantRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  variantDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHAT_COLORS.divider,
  },
  variantLabel: {
    flex: 1,
    color: CHAT_COLORS.ink,
    fontSize: 15,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
  },
  variantPriceWrap: {
    width: 112,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 11,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    backgroundColor: '#F9FAFB',
  },
  variantCurrency: {
    marginRight: 3,
    color: CHAT_COLORS.dim,
    fontSize: 14,
    fontFamily: CHAT_FONT.medium,
  },
  variantInput: {
    flex: 1,
    paddingVertical: 0,
    color: CHAT_COLORS.ink,
    fontSize: 16,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    textAlign: 'right',
  },
  copyButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: CHAT_COLORS.brandSoft,
  },
  copyButtonDisabled: { opacity: 0.45 },
  copyText: {
    color: CHAT_COLORS.brandDeep,
    fontSize: 13,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
  },
  pressed: { opacity: 0.72 },
});
