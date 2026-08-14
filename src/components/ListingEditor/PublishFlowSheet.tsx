import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BRAND_PRIMARY } from '../../design/tokens';
import { CHAT_FONT } from '../../design/chatGlass';
import { getPlatform } from '../../config/platforms';
import type { QualityRow } from '../../utils/listingQuality';
import { hasPlatformPrice } from '../../utils/platformRequirements';
import ListingEditorForm, { type ListingEditorFormProps } from '../ListingEditorForm';
import {
  PublishConfirmationContent,
  type PublishConfirmationContentProps,
} from '../PublishConfirmationModal';

type InlineEditorProps = Omit<ListingEditorFormProps, 'inlineField' | 'inlinePlatform'>;

type PublishNeed = QualityRow & {
  field?: string;
  platform?: string;
};

const FIELD_ORDER = [
  'title',
  'description',
  'price',
  'sku',
  'category',
  'condition',
  'barcode',
  'tags',
  'brand',
  'weight',
  'photos',
];

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  price: 'Price',
  sku: 'SKU',
  category: 'Category',
  condition: 'Condition',
  barcode: 'Barcode',
  tags: 'Tags',
  brand: 'Brand',
  weight: 'Weight',
  photos: 'Photos',
};

const normalizeField = (row: PublishNeed): string => {
  const fromKey = row.key.includes(':') ? row.key.slice(row.key.indexOf(':') + 1) : row.key;
  const raw = row.field || fromKey;
  if (raw === 'images') return 'photos';
  if (raw.startsWith('price')) return 'price';
  return raw;
};

const platformFor = (row: PublishNeed): string | undefined => (
  row.platform || (row.key.includes(':') ? row.key.slice(0, row.key.indexOf(':')) : undefined)
);

const sortNeeds = (rows: PublishNeed[]): PublishNeed[] => (
  [...rows].sort((a, b) => {
    const ai = FIELD_ORDER.indexOf(normalizeField(a));
    const bi = FIELD_ORDER.indexOf(normalizeField(b));
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  })
);

const satisfiesField = (field: string, data: Record<string, any>): boolean => {
  switch (field) {
    case 'price': return hasPlatformPrice(data);
    case 'sku': return typeof data.sku === 'string' && data.sku.trim().length > 0;
    default: return true;
  }
};

export interface PublishFlowSheetProps
  extends Omit<PublishConfirmationContentProps, 'active' | 'onBack' | 'progress'> {
  visible: boolean;
  needsRows: PublishNeed[];
  editorProps: InlineEditorProps;
  onDismiss?: () => void;
}

/** One native modal host for missing-field work and the final publish decision. */
export default function PublishFlowSheet({
  visible,
  needsRows,
  editorProps,
  onDismiss,
  ...confirmationProps
}: PublishFlowSheetProps) {
  const insets = useSafeAreaInsets();
  const initialNeeds = useMemo(() => sortNeeds(needsRows), [needsRows]);
  const [steps, setSteps] = useState<PublishNeed[]>(initialNeeds);
  const [stepIndex, setStepIndex] = useState(initialNeeds.length > 0 ? 0 : initialNeeds.length);
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      const snapshot = sortNeeds(needsRows);
      setSteps(snapshot);
      setStepIndex(snapshot.length > 0 ? 0 : snapshot.length);
    }
    wasVisible.current = visible;
  }, [needsRows, visible]);

  const opening = visible && !wasVisible.current;
  const displayedSteps = opening ? initialNeeds : steps;
  const displayedIndex = opening ? 0 : stepIndex;
  const onConfirmStep = displayedIndex >= displayedSteps.length;
  const totalSteps = displayedSteps.length + 1;
  const close = confirmationProps.onClose;

  const goBack = () => {
    if (displayedIndex <= 0) close();
    else setStepIndex((index) => Math.max(0, index - 1));
  };
  const goNext = () => setStepIndex((index) => Math.min(displayedSteps.length, index + 1));

  const currentNeed = displayedSteps[displayedIndex];
  const currentField = currentNeed ? normalizeField(currentNeed) : '';
  const missingPlatform = currentNeed ? platformFor(currentNeed) : undefined;
  const inlinePlatform = currentField === 'category' ? missingPlatform : 'all';
  const platformLabel = inlinePlatform === 'all'
    ? 'All channels'
    : (inlinePlatform ? getPlatform(inlinePlatform)?.label || inlinePlatform : undefined);
  const relevantPlatformEntries = Object.entries(editorProps.platforms || {}).filter(([, data]) => (
    data && typeof data === 'object'
  ));
  const continueEnabled = currentField === 'category' && missingPlatform
    ? satisfiesField(currentField, editorProps.platforms[missingPlatform] || {})
    : relevantPlatformEntries.every(([, data]) => satisfiesField(currentField, data));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
      onDismiss={onDismiss}
    >
      {onConfirmStep ? (
        <PublishConfirmationContent
          {...confirmationProps}
          active={visible}
          onBack={displayedSteps.length > 0 ? () => setStepIndex(displayedSteps.length - 1) : close}
          progress={{ current: totalSteps, total: totalSteps }}
          productSummary={{
            ...confirmationProps.productSummary,
            imageUrl: confirmationProps.productSummary.imageUrl
              || editorProps.images.find((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0),
          }}
        />
      ) : (
        <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
          <View style={styles.header}>
            <Pressable
              style={({ pressed }) => [styles.backCircle, pressed && styles.pressed]}
              onPress={goBack}
              hitSlop={8}
            >
              <Icon name="chevron-left" size={22} color="#18181B" />
            </Pressable>
            <View style={styles.progressPill}>
              <View style={styles.progress}>
                {Array.from({ length: totalSteps }, (_, index) => (
                  <View
                    key={index}
                    style={[styles.progSeg, index <= displayedIndex && styles.progSegOn]}
                  />
                ))}
              </View>
            </View>
            <Pressable onPress={close} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.contextLabel}>{platformLabel}</Text>
            <Text style={styles.title}>{FIELD_LABELS[currentField] || currentNeed?.label || 'Details'}</Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.editorCard}>
              <ListingEditorForm
                key={`${currentNeed?.key}:${inlinePlatform || 'all'}`}
                {...editorProps}
                inlineField={currentField}
                inlinePlatform={inlinePlatform}
              />
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <Pressable
              onPress={goNext}
              disabled={!continueEnabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: !continueEnabled }}
              style={({ pressed }) => [styles.primaryButton, !continueEnabled && styles.primaryButtonDisabled, pressed && continueEnabled && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>Continue</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  progressPill: { flex: 1, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', justifyContent: 'center', paddingHorizontal: 14, shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  progress: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  progSeg: { flex: 1, height: 4, borderRadius: 999, backgroundColor: '#E5E7EB' },
  progSegOn: { backgroundColor: BRAND_PRIMARY },
  doneText: { color: '#18181B', fontSize: 13, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
  titleBlock: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6, gap: 4 },
  contextLabel: { color: '#71717A', fontSize: 11, fontFamily: CHAT_FONT.semibold, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { color: '#18181B', fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', letterSpacing: -0.22, lineHeight: 28 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },
  editorCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 18, padding: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 12 },
  primaryButton: { alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 54, borderRadius: 16, backgroundColor: BRAND_PRIMARY },
  primaryButtonDisabled: { backgroundColor: '#D6D6D1' },
  primaryLabel: { color: '#FFFFFF', fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
