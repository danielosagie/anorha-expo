import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IC, PillButton } from '../importinbox/InboxKit';
import type { CanonicalRef, SyncItem } from '../../types/syncItem';
import type { CardAnswer } from './questionQueue';

const SURFACE = '#F5F5F7';
const CARD = '#FFFFFF';
const GREEN_TINT = 'rgba(147,200,34,0.12)';

export function money(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : String(value);
}

function ProductImage({ uri, style }: { uri?: string | null; style?: any }) {
  if (uri) {
    return <Image source={{ uri }} resizeMode="cover" style={[styles.image, style]} />;
  }
  return (
    <View style={[styles.image, styles.imageEmpty, style]}>
      <MaterialCommunityIcons name="image-outline" size={24} color={IC.muted} />
    </View>
  );
}

function ItemCopy({ title, price }: { title?: string | null; price?: string | number | null }) {
  return (
    <View style={styles.itemCopy}>
      <Text style={styles.itemTitle} numberOfLines={2}>{title || 'Untitled item'}</Text>
      {money(price) ? <Text style={styles.itemPrice}>{money(price)}</Text> : null}
    </View>
  );
}

function ControlRow({
  primary,
  secondary,
  onPrimary,
  onSecondary,
  onBack,
  backDisabled,
  busy,
  primaryDisabled,
}: {
  primary: string;
  secondary: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onBack?: () => void;
  backDisabled?: boolean;
  busy?: boolean;
  primaryDisabled?: boolean;
}) {
  return (
    <View style={styles.controlRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        disabled={!onBack || backDisabled || busy}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          (!onBack || backDisabled || busy) ? styles.disabled : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <MaterialCommunityIcons name="chevron-left" size={25} color={IC.muted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={secondary}
        disabled={busy}
        onPress={onSecondary}
        style={({ pressed }) => [styles.secondaryButton, (pressed || busy) ? styles.pressed : null]}
      >
        <Text style={styles.secondaryText} numberOfLines={1}>{secondary}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primary}
        disabled={primaryDisabled || busy}
        onPress={onPrimary}
        style={({ pressed }) => [
          styles.primaryButton,
          (pressed || primaryDisabled || busy) ? styles.pressed : null,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={IC.accentInk} />
        ) : (
          <Text style={styles.primaryText} numberOfLines={1}>{primary}</Text>
        )}
      </Pressable>
    </View>
  );
}

export function PairQuestionCard({
  item,
  candidate,
  platformName,
  busy,
  onAnswer,
  onBack,
  backDisabled,
}: {
  item: SyncItem;
  candidate: CanonicalRef | null;
  platformName: string;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  return (
    <View style={styles.questionWrap}>
      <Text style={styles.questionTitle}>Same thing?</Text>
      <View style={styles.pairRow}>
        <View style={styles.productCard}>
          <Text style={styles.eyebrow}>IN {platformName.toUpperCase()}</Text>
          <ProductImage uri={item.imageUrl} style={styles.pairImage} />
          <ItemCopy title={item.title} price={item.price} />
        </View>
        <View style={styles.productCard}>
          <Text style={styles.eyebrow}>IN YOUR SHOP</Text>
          <ProductImage uri={candidate?.imageUrl} style={styles.pairImage} />
          <ItemCopy title={candidate?.title || candidate?.sku || 'Catalog item'} price={candidate?.price} />
        </View>
      </View>
      <ControlRow
        primary="Yes, same thing"
        secondary="No, its new"
        onPrimary={() => onAnswer('primary')}
        onSecondary={() => onAnswer('secondary')}
        onBack={onBack}
        backDisabled={backDisabled}
        busy={busy}
      />
    </View>
  );
}

export function WhichOneQuestionCard({
  item,
  candidates,
  platformName,
  selectedId,
  onSelect,
  busy,
  onAnswer,
  onBack,
  backDisabled,
}: {
  item: SyncItem;
  candidates: CanonicalRef[];
  platformName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  const selectedIndex = candidates.slice(0, 2).findIndex((candidate) => candidate.id === selectedId);
  const selectedLabel = selectedIndex >= 0 ? String.fromCharCode(65 + selectedIndex) : '';
  const incomingMeta = money(item.price)
    ? `in ${platformName} · ${money(item.price)}`
    : `in ${platformName}`;

  return (
    <View style={styles.questionWrap}>
      <View style={styles.heroItem}>
        <ProductImage uri={item.imageUrl} style={styles.heroImage} />
        <Text style={styles.heroTitle} numberOfLines={2}>{item.title || 'Untitled item'}</Text>
        <Text style={styles.heroMeta}>{incomingMeta}</Text>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.questionTitle}>You have two like it.</Text>
        <Text style={styles.questionSubtitle}>Tap the one it matches.</Text>
      </View>

      <View style={styles.pairRow}>
        {candidates.slice(0, 2).map((candidate, index) => {
          const selected = candidate.id === selectedId;
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="button"
              accessibilityLabel={`Choice ${String.fromCharCode(65 + index)}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(candidate.id)}
              style={({ pressed }) => [
                styles.candidateCard,
                selected ? styles.candidateSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.choiceLabel}>
                <Text style={styles.choiceLabelText}>{String.fromCharCode(65 + index)}</Text>
              </View>
              <ProductImage uri={candidate.imageUrl} style={styles.pairImage} />
              <ItemCopy title={candidate.title || candidate.sku || 'Catalog item'} price={candidate.price} />
              {selected ? (
                <View style={styles.selectedCheck}>
                  <MaterialCommunityIcons name="check" size={14} color={IC.accentInk} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <ControlRow
        primary={selectedLabel ? `Yes, it's (${selectedLabel})` : "Yes, it's"}
        secondary="No, its new"
        onPrimary={() => onAnswer('primary')}
        onSecondary={() => onAnswer('secondary')}
        onBack={onBack}
        backDisabled={backDisabled}
        busy={busy}
        primaryDisabled={!selectedId}
      />
    </View>
  );
}

export function HandoffCard({
  count,
  thumbnails,
  busy,
  error,
  onFinish,
  onKeepShowing,
}: {
  count: number;
  thumbnails: Array<string | null>;
  busy?: boolean;
  error?: string | null;
  onFinish: () => void;
  onKeepShowing: () => void;
}) {
  return (
    <View style={styles.handoffWrap}>
      <View style={styles.checkedThumbs}>
        {thumbnails.slice(-3).map((uri, index) => (
          <View key={`${uri || 'empty'}:${index}`} style={styles.checkedThumbWrap}>
            <ProductImage uri={uri} style={styles.checkedThumb} />
            <View style={styles.thumbCheck}>
              <MaterialCommunityIcons name="check" size={13} color={IC.accentInk} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.questionTitle}>The next {count} look just like those.</Text>
        <Text style={styles.questionSubtitle}>Want us to answer them the same way?</Text>
      </View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <View style={styles.handoffActions}>
        <PillButton label="Yes, finish them" onPress={onFinish} loading={busy} disabled={busy} />
        <PillButton label="Keep showing me" variant="secondary" onPress={onKeepShowing} disabled={busy} />
      </View>
    </View>
  );
}

export function CardLoading() {
  return (
    <View style={styles.loadingCard}>
      <ActivityIndicator color={IC.accent} />
    </View>
  );
}

export function QuestionScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: SURFACE },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30 },
  questionWrap: { flex: 1, gap: 22 },
  questionTitle: {
    color: IC.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.7,
    textAlign: 'center',
  },
  questionSubtitle: {
    color: IC.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  titleBlock: { gap: 5 },
  pairRow: { flexDirection: 'row', gap: 12 },
  productCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    gap: 10,
  },
  candidateCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    padding: 12,
    gap: 10,
    position: 'relative',
  },
  candidateSelected: { borderColor: IC.accent, backgroundColor: GREEN_TINT },
  image: { backgroundColor: '#EEEFF1' },
  imageEmpty: { alignItems: 'center', justifyContent: 'center' },
  pairImage: { width: '100%', aspectRatio: 1, borderRadius: 14 },
  eyebrow: {
    color: IC.muted,
    fontFamily: 'Inter_700Bold',
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
  itemCopy: { gap: 3 },
  itemTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  itemPrice: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroItem: { alignItems: 'center', gap: 5 },
  heroImage: { width: 104, height: 104, borderRadius: 18, marginBottom: 5 },
  heroTitle: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22, textAlign: 'center' },
  heroMeta: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  choiceLabel: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1EF',
  },
  choiceLabelText: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 12 },
  selectedCheck: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IC.accent,
  },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' },
  backButton: {
    width: 46,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
  },
  primaryButton: {
    flex: 1.16,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IC.accent,
    paddingHorizontal: 10,
  },
  secondaryText: { color: IC.ink, fontFamily: 'Inter_700Bold', fontSize: 13 },
  primaryText: { color: IC.accentInk, fontFamily: 'Inter_700Bold', fontSize: 13 },
  pressed: { opacity: 0.58 },
  disabled: { opacity: 0.35 },
  handoffWrap: { flex: 1, justifyContent: 'center', gap: 26 },
  checkedThumbs: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  checkedThumbWrap: { position: 'relative' },
  checkedThumb: { width: 76, height: 76, borderRadius: 16 },
  thumbCheck: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: IC.accent,
    borderWidth: 2,
    borderColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handoffActions: { gap: 10, marginTop: 'auto' },
  inlineError: { color: '#B42318', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center' },
  loadingCard: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 280 },
});
