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
import PlatformLogo from '../PlatformLogo';
import { IC, PillButton } from '../importinbox/InboxKit';
import { getPlatform, normalizeDisplayName } from '../../config/platforms';
import type { CanonicalRef, SyncItem } from '../../types/syncItem';
import { candidateUpdatedLabel, type CardAnswer, type QuestionCardModel } from './questionQueue';

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

// The deck's control row, from the Paper V2A footer: [undo] [secondary] [primary]
// on ONE line — undo lives here (not in a notice strip), so taking back the
// last answer sits beside making the next one. "Later" rides quietly beneath.
export function ControlRow({
  primary,
  secondary,
  onPrimary,
  onSecondary,
  onUndo,
  undoDisabled,
  busy,
  primaryDisabled,
  later = 'Later',
  onLater,
}: {
  primary: string;
  secondary: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
  busy?: boolean;
  primaryDisabled?: boolean;
  later?: string | null;
  onLater?: () => void;
}) {
  return (
    <View style={styles.actions}>
      <View style={styles.controlRow}>
        {onUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo last answer"
            disabled={undoDisabled || busy}
            onPress={onUndo}
            style={({ pressed }) => [
              styles.undoCircle,
              (undoDisabled || busy) ? styles.undoCircleDisabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <MaterialCommunityIcons name="undo-variant" size={21} color={(undoDisabled || busy) ? '#C6C8CC' : '#6B7280'} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={secondary}
          disabled={busy}
          onPress={onSecondary}
          style={({ pressed }) => [styles.controlSecondary, (pressed || busy) ? styles.pressed : null]}
        >
          <Text style={styles.controlSecondaryText} numberOfLines={1}>{secondary}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primary}
          disabled={primaryDisabled || busy}
          onPress={onPrimary}
          style={({ pressed }) => [
            styles.controlPrimary,
            (pressed || busy || primaryDisabled) ? styles.pressed : null,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.controlPrimaryText} numberOfLines={1}>{primary}</Text>
          )}
        </Pressable>
      </View>
      {later && onLater ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={later}
          disabled={busy}
          onPress={onLater}
          style={({ pressed }) => [styles.laterButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.laterText}>{later}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function QuestionActions({
  primary,
  secondary,
  onPrimary,
  onSecondary,
  onTertiary,
  onUndo,
  undoDisabled,
  busy,
  primaryDisabled,
}: {
  primary: string;
  secondary: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onTertiary: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
  busy?: boolean;
  primaryDisabled?: boolean;
}) {
  return (
    <ControlRow
      primary={primary}
      secondary={secondary}
      onPrimary={onPrimary}
      onSecondary={onSecondary}
      onUndo={onUndo}
      undoDisabled={undoDisabled}
      busy={busy}
      primaryDisabled={primaryDisabled}
      onLater={onTertiary}
    />
  );
}

// Source tag: platform icon + name in a small chip before the item's name,
// same visual grammar as the inventory list's platform badges.
export function SourceTag({ platformKey, label }: { platformKey: string; label: string }) {
  return (
    <View style={styles.sourceTag}>
      <PlatformLogo type={platformKey} size={13} fallbackIcon="file-delimited-outline" />
      <Text style={styles.sourceTagText} numberOfLines={1}>{label}</Text>
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

// The tellable-apart block for a which_one candidate: platform badge, SKU,
// updated-at. When two candidates share title, price, and placeholder images
// (run 8 P2-2), these rows are the ONLY thing the seller can choose by.
function CandidateMeta({ candidate, shownTitle }: { candidate: CanonicalRef; shownTitle: string }) {
  const platformRaw = (candidate.sourcePlatform || '').trim();
  const platformLabel = platformRaw
    ? getPlatform(platformRaw.toLowerCase())?.label || normalizeDisplayName(platformRaw) || platformRaw
    : '';
  const sku = (candidate.sku || '').trim();
  const updated = candidateUpdatedLabel(candidate.updatedAt);
  const showSku = Boolean(sku) && sku !== shownTitle;
  if (!platformLabel && !showSku && !updated) return null;
  return (
    <View style={styles.candidateMeta}>
      {platformLabel ? <SourceTag platformKey={platformRaw.toLowerCase()} label={platformLabel} /> : null}
      {showSku ? <Text style={styles.candidateMetaText} numberOfLines={1}>{sku}</Text> : null}
      {updated ? <Text style={styles.candidateMetaText} numberOfLines={1}>{updated}</Text> : null}
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
  platformKey,
  busy,
  onAnswer,
  onUndo,
  undoDisabled,
}: {
  item: SyncItem;
  candidate: CanonicalRef | null;
  platformName: string;
  platformKey?: string;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
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
          <SourceTag platformKey={platformKey || platformName.toLowerCase()} label={platformName} />
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
        onUndo={onUndo}
        undoDisabled={undoDisabled}
        busy={busy}
      />
    </View>
  );
}

export function WhichOneQuestionCard({
  item,
  candidates,
  platformName,
  platformKey,
  selectedId,
  onSelect,
  busy,
  onAnswer,
  onUndo,
  undoDisabled,
}: {
  item: SyncItem;
  candidates: CanonicalRef[];
  platformName: string;
  platformKey?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
}) {
  return (
    <View style={styles.questionWrap}>
      <View style={styles.incomingCompact}>
        <ProductImage uri={item.imageUrl} style={styles.incomingImage} />
        <View style={styles.incomingCopy}>
          <SourceTag platformKey={platformKey || platformName.toLowerCase()} label={platformName} />
          <Text style={styles.incomingTitle} numberOfLines={2}>{item.title || 'Untitled item'}</Text>
          {money(item.price) ? <Text style={styles.incomingMeta} numberOfLines={1}>{money(item.price)}</Text> : null}
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.questionTitle}>You have two like it.</Text>
        <Text style={styles.questionSubtitle}>Tap the one it matches.</Text>
      </View>

      <View style={styles.pairRow}>
        {candidates.slice(0, 2).map((candidate) => {
          const selected = candidate.id === selectedId;
          const shownTitle = candidate.title || candidate.sku || 'Catalog item';
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
              <ItemCopy title={shownTitle} price={candidate.price} />
              <CandidateMeta candidate={candidate} shownTitle={shownTitle} />
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
        onUndo={onUndo}
        undoDisabled={undoDisabled}
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
  onUndo,
  undoDisabled,
}: {
  card: QuestionCardModel;
  busy?: boolean;
  onAnswer: (answer: CardAnswer) => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
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
        onUndo={onUndo}
        undoDisabled={undoDisabled}
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
  onUndo,
  undoDisabled,
}: {
  items: SyncItem[];
  busy?: boolean;
  onGenerate: () => void;
  onManual: () => void;
  onUnsure: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
}) {
  return (
    <View style={styles.questionWrap}>
      <Text style={styles.questionTitle}>{items.length} {items.length === 1 ? 'item needs' : 'items need'} titles</Text>
      <View style={styles.titleThumbs}>
        {items.slice(0, 3).map((item) => (
          <ProductImage key={item.platformId} uri={item.imageUrl} style={styles.titleThumb} />
        ))}
      </View>
      <ControlRow
        primary="Write them for me"
        secondary="I'll do it"
        onPrimary={onGenerate}
        onSecondary={onManual}
        onUndo={onUndo}
        undoDisabled={undoDisabled}
        busy={busy}
        onLater={onUnsure}
      />
    </View>
  );
}

export function CommitFailedCard({
  items,
  busy,
  onRetry,
  onLater,
  onUndo,
  undoDisabled,
}: {
  items: SyncItem[];
  busy?: boolean;
  onRetry: () => void;
  onLater: () => void;
  onUndo?: () => void;
  undoDisabled?: boolean;
}) {
  const first = items[0];
  const single = items.length === 1;
  return (
    <View style={styles.questionWrap}>
      <View style={styles.warningIcon}>
        <MaterialCommunityIcons name="alert-outline" size={26} color={AMBER} />
      </View>
      <Text style={styles.questionTitle}>
        {single ? 'Try this item again?' : `Try these ${items.length} again?`}
      </Text>
      {single && first ? (
        <View style={styles.incomingCompact}>
          <ProductImage uri={first.imageUrl} style={styles.incomingImage} />
          <View style={styles.incomingCopy}>
            <Text style={styles.incomingTitle} numberOfLines={2}>{first.title || 'Untitled item'}</Text>
            <Text style={styles.failureReason}>{first.reason || 'It did not finish importing.'}</Text>
          </View>
        </View>
      ) : (
        <>
          <MemberRows items={items} />
          {first?.reason ? <Text style={styles.reasonText}>{first.reason}</Text> : null}
        </>
      )}
      <ControlRow
        primary="Try again"
        secondary="Later"
        onPrimary={onRetry}
        onSecondary={onLater}
        onUndo={onUndo}
        undoDisabled={undoDisabled}
        busy={busy}
        later={null}
      />
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
      <ControlRow
        primary="Save title"
        secondary="Later"
        onPrimary={onSave}
        onSecondary={onUnsure}
        busy={busy}
        primaryDisabled={!value.trim()}
        later={null}
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
  sourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: 4,
  },
  sourceTagText: { color: '#5F6065', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  image: { backgroundColor: '#EEEFF1', borderRadius: 13 },
  imageEmpty: { alignItems: 'center', justifyContent: 'center' },
  pairImage: { width: '100%', aspectRatio: 1 },
  itemCopy: { gap: 3, minHeight: 58 },
  itemTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18 },
  itemPrice: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  actions: { gap: 10, marginTop: 'auto' },
  actionRow: { flexDirection: 'row', gap: 10 },
  // Paper V2A control row: undo circle · secondary pill · primary pill.
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  undoCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  undoCircleDisabled: { opacity: 0.5 },
  controlSecondary: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  controlSecondaryText: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20 },
  controlPrimary: {
    flex: 1.3,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  controlPrimaryText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 20 },
  laterButton: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 24 },
  laterText: { color: '#5F6065', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
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
  candidateMeta: { gap: 3, alignItems: 'flex-start' },
  candidateMetaText: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, lineHeight: 15 },
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
