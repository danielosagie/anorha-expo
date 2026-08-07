// BestGuesses: the V2A "First, our best guesses" checklist and its confirm
// handoff. Rows are grouped by what the tap DOES (link / add as new), every
// row arrives pre-checked, and unchecking a row sends that question to the
// one-card deck instead. Pure presentation: selection logic lives in
// questionQueue.ts (selectBestGuessCards).

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IC, PillButton, SuccessCheck } from '../importinbox/InboxKit';
import type { BestGuessAction } from './questionQueue';

const CARD = '#FFFFFF';

export interface BestGuessRowModel {
  id: string;
  action: BestGuessAction;
  title: string;
  sub: string | null;
  imageUrl: string | null;
  checked: boolean;
}

function Thumb({ uri }: { uri: string | null }) {
  if (uri) return <Image source={{ uri }} resizeMode="cover" style={styles.thumb} />;
  return (
    <View style={[styles.thumb, styles.thumbEmpty]}>
      <MaterialCommunityIcons name="image-outline" size={20} color={IC.muted} />
    </View>
  );
}

function GuessRow({
  row,
  onToggle,
  disabled,
}: {
  row: BestGuessRowModel;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.checked }}
      accessibilityLabel={row.sub ? `${row.title}, ${row.sub}` : row.title}
      disabled={disabled}
      onPress={() => onToggle(row.id)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Thumb uri={row.imageUrl} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
        {row.sub ? <Text style={styles.rowSub} numberOfLines={1}>{row.sub}</Text> : null}
      </View>
      <View style={[styles.check, row.checked ? styles.checkOn : styles.checkOff]}>
        {row.checked ? <MaterialCommunityIcons name="check" size={15} color={IC.accentInk} /> : null}
      </View>
    </Pressable>
  );
}

function GuessSection({
  label,
  rows,
  onToggle,
  disabled,
}: {
  label: string;
  rows: BestGuessRowModel[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionCard}>
        {rows.map((row, index) => (
          <React.Fragment key={row.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <GuessRow row={row} onToggle={onToggle} disabled={disabled} />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

export function BestGuessChecklist({
  rows,
  onToggle,
  disabled,
}: {
  rows: BestGuessRowModel[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.list}>
      <GuessSection
        label="Same item in two stores · link them"
        rows={rows.filter((row) => row.action === 'link')}
        onToggle={onToggle}
        disabled={disabled}
      />
      <GuessSection
        label="Nothing like them yet · add as new"
        rows={rows.filter((row) => row.action === 'add')}
        onToggle={onToggle}
        disabled={disabled}
      />
    </View>
  );
}

export function GuessHandoffCard({
  confirmed,
  remaining,
  busy,
  onShow,
  onLater,
}: {
  confirmed: number;
  remaining: number;
  busy?: boolean;
  onShow: () => void;
  onLater: () => void;
}) {
  return (
    <View style={styles.handoffWrap}>
      <View style={styles.handoffCheck}>
        <SuccessCheck size={64} />
      </View>
      <View style={styles.handoffCopy}>
        <Text style={styles.handoffTitle}>{confirmed} confirmed</Text>
        <Text style={styles.handoffSub}>
          Now the {remaining} we didn’t want to guess.
        </Text>
        <Text style={styles.handoffSub}>One card, one question.</Text>
      </View>
      <View style={styles.handoffActions}>
        <PillButton label="Show me" onPress={onShow} loading={busy} disabled={busy} />
        <PillButton label="Finish later" variant="secondary" onPress={onLater} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 24 },
  section: { gap: 9 },
  sectionLabel: {
    color: IC.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    paddingHorizontal: 3,
  },
  sectionCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E7E7EA',
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#ECECEF' },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pressed: { opacity: 0.58 },
  thumb: { width: 46, height: 46, borderRadius: 11, backgroundColor: '#EEEFF1' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: IC.ink, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  rowSub: { color: IC.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: IC.accent },
  checkOff: { borderWidth: 1.5, borderColor: '#D6D7DA', backgroundColor: CARD },

  handoffWrap: { flex: 1, justifyContent: 'center', gap: 26 },
  handoffCheck: { alignItems: 'center' },
  handoffCopy: { gap: 5 },
  handoffTitle: {
    color: IC.ink,
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.7,
    textAlign: 'center',
  },
  handoffSub: {
    color: IC.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  handoffActions: { gap: 10, marginTop: 'auto' },
});
