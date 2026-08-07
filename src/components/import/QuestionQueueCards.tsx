import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IC, PillButton } from '../importinbox/InboxKit';
import type { CanonicalRef, SyncItem } from '../../types/syncItem';
import type { CardAnswer, QuestionCardModel } from './questionQueue';

const SURFACE = '#F5F5F7';
const CARD = '#FFFFFF';
const AMBER = '#BA7517';
const GREEN_TINT = 'rgba(147,200,34,0.12)';

export function money(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : String(value);
}

function displayValue(value: unknown): string {
  if (typeof value === 'number') return money(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return money(trimmed);
    return trimmed;
  }
  return '';
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

function SmallButton({
  label,
  onPress,
  disabled,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallButton,
        quiet ? styles.smallButtonQuiet : styles.smallButtonBordered,
        (pressed || disabled) ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.smallButtonText, quiet ? styles.quietText : null]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuestionActions({
  primary,
  secondary,
  // One word for deferral everywhere. "Later" is truthful — the row lands in
  // Needs a look; "Skip"/"Not sure" read as gone.
  tertiary = 'Later',
  onPrimary,
  onSecondary,
  onTertiary,
  busy,
  primaryDisabled,
}: {
  primary: string;
  secondary: string;
  tertiary?: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onTertiary: () => void;
  busy?: boolean;
  primaryDisabled?: boolean;
}) {
  return (
    <View style={styles.actions}>
      <PillButton
        label={primary}
        onPress={onPrimary}
        loading={busy}
        disabled={primaryDisabled || busy}
      />
      <View style={styles.actionRow}>
        <SmallButton label={secondary} onPress={onSecondary} disabled={busy} />
        <SmallButton label={tertiary} onPress={onTertiary} disabled={busy} quiet />
      </View>
    </View>
  );
}

function ItemCopy({ title, price }: { title: string; price?: string | number | null }) {
  const shownPrice = money(price);
  return (
    <View style={styles.itemCopy}>
      <Text style={styles.itemTitle} numberOfLines={2}>{title || 'Untitled item'}</Text>
      {shownPrice ? <Text style={styles.itemPrice}>{shownPrice}</Text> : null}
    </View>
  );
}

function conflictValues(item: SyncItem, candidate: CanonicalRef | null): { incoming: string; catalog: string } {
  const conflict = item.fieldConflicts?.[0];
  const incoming = displayValue(conflict?.incomingValue ?? conflict?.platformValue ?? item.price);
  const catalog = displayValue(conflict?.canonicalValue ?? conflict?.catalogValue ?? candidate?.price);
  return { incoming: incoming || 'this value', catalog: catalog || 'your value' };
}

export function PairQuestionCard({
  item,
  candidate,
  platformName,
  busy,
  onAnswer,
}: {
  item: SyncItem;
  candidate: CanonicalRef | null;
  platformName: string;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
}) {
  const fieldConflict = item.attention === 'field_conflict';
  const values = conflictValues(item, candidate);
  const question = fieldConflict
    ? `Keep ${values.incoming} or take ${values.catalog}?`
    : item.attention === 'stale_link'
      ? 'Still the same thing?'
      : 'Same thing?';
  // The verb rides on the button: the tap IS the action, never a bare yes.
  const primary = fieldConflict ? `Keep ${values.incoming}` : 'Yes, link';
  const secondary = fieldConflict ? `Take ${values.catalog}` : 'No, add as new';

  return (
    <View style={styles.questionWrap}>
      <Text style={styles.questionTitle}>{question}</Text>
      <View style={styles.pairRow}>
        <View style={styles.productCard}>
          <Text style={styles.eyebrow}>IN {platformName.toUpperCase()}</Text>
          <ProductImage uri={item.imageUrl} style={styles.pairImage} />
          <ItemCopy title={item.title} price={item.price} />
        </View>
        <View style={styles.productCard}>
          <Text style={styles.eyebrow}>IN YOUR SHOP</Text>
          <ProductImage uri={candidate?.imageUrl} style={styles.pairImage} />
          <ItemCopy title={candidate?.title || candidate?.sku || 'Your catalog item'} price={candidate?.price} />
        </View>
      </View>
      <QuestionActions
        primary={primary}
        secondary={secondary}
        onPrimary={() => onAnswer('primary')}
        onSecondary={() => onAnswer('secondary')}
        onTertiary={() => onAnswer('unsure')}
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
}: {
  item: SyncItem;
  candidates: CanonicalRef[];
  platformName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
}) {
  return (
    <View style={styles.questionWrap}>
      <View style={styles.incomingCompact}>
        <ProductImage uri={item.imageUrl} style={styles.incomingImage} />
        <View style={styles.incomingCopy}>
          <Text style={styles.incomingTitle} numberOfLines={2}>{item.title || 'Untitled item'}</Text>
          <Text style={styles.incomingMeta} numberOfLines={1}>
            in {platformName}{money(item.price) ? ` · ${money(item.price)}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.questionTitle}>You have two like it.</Text>
        <Text style={styles.questionSubtitle}>Tap the one it matches.</Text>
      </View>

      <View style={styles.pairRow}>
        {candidates.slice(0, 2).map((candidate) => {
          const selected = candidate.id === selectedId;
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(candidate.id)}
              style={({ pressed }) => [
                styles.candidateCard,
                selected ? styles.candidateSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <ProductImage uri={candidate.imageUrl} style={styles.pairImage} />
              <ItemCopy title={candidate.title || candidate.sku || 'Catalog item'} price={candidate.price} />
              {selected ? (
                <View style={styles.selectedCheck}>
                  <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <QuestionActions
        primary="Yes, this one"
        secondary="None, add as new"
        onPrimary={() => onAnswer('primary')}
        onSecondary={() => onAnswer('secondary')}
        onTertiary={() => onAnswer('unsure')}
        busy={busy}
        primaryDisabled={!selectedId}
      />
    </View>
  );
}

function MemberRows({ items, limit = 6 }: { items: SyncItem[]; limit?: number }) {
  return (
    <View style={styles.memberList}>
      {items.slice(0, limit).map((item) => (
        <View key={item.platformId} style={styles.memberRow}>
          <ProductImage uri={item.imageUrl} style={styles.memberImage} />
          <View style={styles.memberCopy}>
            <Text style={styles.memberTitle} numberOfLines={1}>{item.title || item.sku || 'Untitled item'}</Text>
            {money(item.price) ? <Text style={styles.memberMeta}>{money(item.price)}</Text> : null}
          </View>
        </View>
      ))}
      {items.length > limit ? <Text style={styles.moreRows}>+ {items.length - limit} more</Text> : null}
    </View>
  );
}

export function GroupQuestionCard({
  card,
  busy,
  onAnswer,
}: {
  card: QuestionCardModel;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
}) {
  const isLookAlike = card.kind === 'look_alike_group';
  const isDuplicate = card.kind === 'duplicate_target';
  const title = isLookAlike
    ? `One product in ${card.items.length} sizes?`
    : isDuplicate
      ? 'These point to one item.'
      : 'One set, or separate items?';
  const primary = isLookAlike ? 'Combine' : isDuplicate ? 'Merge' : 'One set';
  const secondary = isLookAlike || isDuplicate ? 'Keep separate' : 'Separate items';
  const parts = card.items.flatMap((item) => item.bundleParts ?? []);

  return (
    <View style={styles.questionWrap}>
      <Text style={styles.questionTitle}>{title}</Text>
      {parts.length > 0 ? (
        <View style={styles.memberList}>
          {parts.slice(0, 8).map((part, index) => (
            <View key={`${part.sku || part.title || 'part'}:${index}`} style={styles.partRow}>
              <View style={styles.partDot} />
              <Text style={styles.partText}>{part.title || part.sku || `Part ${index + 1}`}</Text>
            </View>
          ))}
        </View>
      ) : (
        <MemberRows items={card.items} />
      )}
      {card.items[0]?.reason ? <Text style={styles.reasonText}>{card.items[0].reason}</Text> : null}
      <QuestionActions
        primary={primary}
        secondary={secondary}
        onPrimary={() => onAnswer('primary')}
        onSecondary={() => onAnswer('secondary')}
        onTertiary={() => onAnswer('unsure')}
        busy={busy}
      />
    </View>
  );
}

export function TitleQualityCard({
  items,
  busy,
  onGenerate,
  onManual,
  onUnsure,
}: {
  items: SyncItem[];
  busy?: boolean;
  onGenerate: () => void;
  onManual: () => void;
  onUnsure: () => void;
}) {
  return (
    <View style={styles.questionWrap}>
      <Text style={styles.questionTitle}>{items.length} {items.length === 1 ? 'item needs' : 'items need'} titles</Text>
      <View style={styles.titleThumbs}>
        {items.slice(0, 3).map((item) => (
          <ProductImage key={item.platformId} uri={item.imageUrl} style={styles.titleThumb} />
        ))}
      </View>
      <View style={styles.actions}>
        <PillButton label="Write them for me" onPress={onGenerate} loading={busy} disabled={busy} />
        <View style={styles.actionRow}>
          <SmallButton label="I'll do it" onPress={onManual} disabled={busy} />
          <SmallButton label="Later" onPress={onUnsure} disabled={busy} quiet />
        </View>
      </View>
    </View>
  );
}

export function CommitFailedCard({
  item,
  busy,
  onRetry,
  onLater,
}: {
  item: SyncItem;
  busy?: boolean;
  onRetry: () => void;
  onLater: () => void;
}) {
  return (
    <View style={styles.questionWrap}>
      <View style={styles.warningIcon}>
        <MaterialCommunityIcons name="alert-outline" size={26} color={AMBER} />
      </View>
      <Text style={styles.questionTitle}>Try this item again?</Text>
      <View style={styles.incomingCompact}>
        <ProductImage uri={item.imageUrl} style={styles.incomingImage} />
        <View style={styles.incomingCopy}>
          <Text style={styles.incomingTitle} numberOfLines={2}>{item.title || 'Untitled item'}</Text>
          <Text style={styles.failureReason}>{item.reason || 'It did not finish importing.'}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <PillButton label="Try again" onPress={onRetry} loading={busy} disabled={busy} />
        <PillButton label="Later" variant="secondary" onPress={onLater} disabled={busy} />
      </View>
    </View>
  );
}

export function TitleEntryCard({
  item,
  index,
  total,
  value,
  onChange,
  onSave,
  onUnsure,
  busy,
}: {
  item: SyncItem;
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onUnsure: () => void;
  busy?: boolean;
}) {
  return (
    <View style={styles.questionWrap}>
      <Text style={styles.entryCount}>{index + 1} of {total}</Text>
      <ProductImage uri={item.imageUrl} style={styles.entryImage} />
      <Text style={styles.questionTitle}>What should we call it?</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Item title"
        placeholderTextColor={IC.muted}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={value.trim() ? onSave : undefined}
        editable={!busy}
        style={styles.titleInput}
      />
      <View style={styles.actions}>
        <PillButton label="Save title" onPress={onSave} disabled={!value.trim() || busy} loading={busy} />
        <PillButton label="Later" variant="secondary" onPress={onUnsure} disabled={busy} />
      </View>
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
              <MaterialCommunityIcons name="check" size={13} color="#FFFFFF" />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.questionTitle}>The next {count} look just like those.</Text>
        <Text style={styles.questionSubtitle}>Want us to answer them the same way?</Text>
      </View>
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <View style={styles.actions}>
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
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
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
  pairRow: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  productCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E7E7EA',
    padding: 10,
    gap: 9,
  },
  eyebrow: {
    color: IC.muted,
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
    minHeight: 25,
  },
  image: { backgroundColor: '#EEEFF1', borderRadius: 13 },
  imageEmpty: { alignItems: 'center', justifyContent: 'center' },
  pairImage: { width: '100%', aspectRatio: 1 },
  itemCopy: { gap: 3, minHeight: 58 },
  itemTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18 },
  itemPrice: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  actions: { gap: 10, marginTop: 'auto' },
  actionRow: { flexDirection: 'row', gap: 10 },
  smallButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonBordered: { backgroundColor: CARD, borderWidth: 1, borderColor: '#DFE0E3' },
  smallButtonQuiet: { backgroundColor: '#ECECEF' },
  smallButtonText: {
    color: IC.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  quietText: { color: '#5F6065' },
  pressed: { opacity: 0.55 },
  incomingCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E7E7EA',
  },
  incomingImage: { width: 64, height: 64 },
  incomingCopy: { flex: 1, minWidth: 0, gap: 3 },
  incomingTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  incomingMeta: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  candidateCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 9,
    gap: 9,
    position: 'relative',
  },
  candidateSelected: { borderColor: IC.accent },
  selectedCheck: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: IC.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberList: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E7E7EA',
    paddingHorizontal: 14,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62, paddingVertical: 8 },
  memberImage: { width: 46, height: 46, borderRadius: 11 },
  memberCopy: { flex: 1, minWidth: 0 },
  memberTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  memberMeta: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  moreRows: { color: IC.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  partRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  partDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: IC.accent },
  partText: { flex: 1, color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  reasonText: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  titleThumbs: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 8 },
  titleThumb: { width: 82, height: 82, borderRadius: 16 },
  warningIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(186,117,23,0.10)',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failureReason: { color: AMBER, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  entryCount: { color: IC.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center' },
  entryImage: { width: 150, height: 150, borderRadius: 24, alignSelf: 'center' },
  titleInput: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#D6D7DA',
    backgroundColor: CARD,
    color: IC.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    paddingHorizontal: 16,
  },
  handoffWrap: { flex: 1, justifyContent: 'center', gap: 26 },
  checkedThumbs: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  checkedThumbWrap: { position: 'relative' },
  checkedThumb: { width: 82, height: 82, borderRadius: 16 },
  thumbCheck: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: IC.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: SURFACE,
  },
  inlineError: { color: '#B42318', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  loadingCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
