// optimizeResolvers — the Optimize·v2 resolver screens (after Match).
// Fill the gaps within an item: bad photos, AI-draftable details, and the
// manual fields AI can't safely guess. Faithful hi-fi translations of
// wireframes-optimize.jsx, built on the shared ResolveKit.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  RC,
  ResolveShell,
  Row,
  Check,
  Thumb,
  OptionRow,
  Field,
  Banner,
  Chip,
} from './ResolveKit';

export type OptimizeKind = 'photobad' | 'datachoose' | 'dataselect' | 'datareview' | 'manual';

export interface OptimizeFieldSpec {
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  half?: boolean;
}
export interface OptimizeCase {
  id: string;
  kind: OptimizeKind;
  title: string;
  note?: string;
  itemTitle?: string;
  itemImage?: string | null;
  itemSub?: string;
  count?: number;
  minWarning?: string;
  fields?: OptimizeFieldSpec[];
  rows?: { id: string; title: string; sub?: string; miss?: string; on?: boolean }[];
  diff?: { titleOld?: string; titleNew?: string; descNew?: string };
  chips?: string[];
}

export type Decision = 'primary' | 'alt';

/** Extra payload some optimize resolvers report up (chosen route / selection). */
export interface OptimizeResolveMeta {
  route?: 'all' | 'pick' | 'hand';
  selectedIds?: string[];
}

interface RProps {
  c: OptimizeCase;
  idx: number;
  total: number;
  topInset: number;
  onBack: () => void;
  onResolve: (d: Decision, meta?: OptimizeResolveMeta) => void;
}

// ═══ BAD PHOTO — broken/low-quality existing image ════════════════════════
function OP_PhotoBad({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="photos"
      title={c.title || 'Bad photo'}
      note={c.note || c.itemTitle}
      topInset={topInset}
      onBack={onBack}
      primary="Reshoot now"
      primaryIcon="camera"
      alt="Remove it — keep the rest"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
          <View style={op.badPhoto}>
            <MaterialCommunityIcons name="image-broken-variant" size={24} color={RC.danger} />
          </View>
          <Text style={[op.photoCap, { color: RC.dangerInk }]}>404 · won’t load</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
          <Thumb uri={c.itemImage} size={80} radius={8} />
          <Text style={op.photoCap}>1 good photo</Text>
        </View>
      </View>
      {!!c.minWarning && <Banner text={c.minWarning} tone="warn" />}
    </ResolveShell>
  );
}

// ═══ CHOOSE HOW — route the detail fix ════════════════════════════════════
function OP_DataChoose({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const [pick, setPick] = useState(0);
  const n = c.count ?? 0;
  const opts = [
    { icon: 'auto-fix' as const, title: `Generate all ${n}`, sub: 'drafts title + description' },
    { icon: 'format-list-bulleted' as const, title: 'Pick how many', sub: 'choose a subset' },
    { icon: 'pencil' as const, title: 'Fill by hand', sub: 'write them yourself' },
  ];
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="details"
      title={c.title || `${n} need details`}
      note={c.note || 'Weak titles & thin copy'}
      topInset={topInset}
      onBack={onBack}
      primary={pick === 0 ? `Generate all ${n}` : pick === 1 ? 'Pick how many' : 'Fill by hand'}
      primaryIcon={pick === 0 ? 'auto-fix' : pick === 1 ? 'format-list-bulleted' : 'pencil'}
      alt="Choose later"
      onPrimary={() => onResolve('primary', { route: pick === 0 ? 'all' : pick === 1 ? 'pick' : 'hand' })}
      onAlt={() => onResolve('alt')}
    >
      {opts.map((o, i) => (
        <OptionRow key={i} on={pick === i} icon={o.icon} title={o.title} sub={o.sub} onPress={() => setPick(i)} />
      ))}
      {!!(c.chips && c.chips.length) && (
        <View style={op.chipWrap}>
          {c.chips.map((t) => (
            <View key={t} style={op.fieldChip}>
              <Text style={op.fieldChipText}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </ResolveShell>
  );
}

// ═══ PICK HOW MANY — select a subset ══════════════════════════════════════
function OP_DataSelect({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const rows = c.rows || [];
  const [sel, setSel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.on !== false])),
  );
  const count = Object.values(sel).filter(Boolean).length;
  const allOn = count === rows.length && rows.length > 0;
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="details"
      title={c.title || 'Pick how many'}
      note={c.note || 'Tap to include'}
      topInset={topInset}
      onBack={onBack}
      primary={`Generate for ${count}`}
      primaryIcon="auto-fix"
      primaryReady={count > 0}
      primaryGate="Select at least one"
      alt={allOn ? 'Clear all' : `Select all ${rows.length}`}
      onPrimary={() => onResolve('primary', { selectedIds: Object.keys(sel).filter((k) => sel[k]) })}
      onAlt={() => onResolve('alt')}
    >
      <View style={op.selHead}>
        <Text style={op.selCount}>{count} selected</Text>
        <TouchableOpacity
          style={op.selAll}
          onPress={() => setSel(Object.fromEntries(rows.map((r) => [r.id, !allOn])))}
        >
          <Check on={allOn} size={16} />
          <Text style={op.selAllText}>Select all</Text>
        </TouchableOpacity>
      </View>
      {rows.map((r) => {
        const on = !!sel[r.id];
        return (
          <Row key={r.id} active={on} onPress={() => setSel((p) => ({ ...p, [r.id]: !p[r.id] }))}>
            <Check on={on} size={18} />
            <Thumb size={26} radius={6} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={op.rowTitle} numberOfLines={1}>{r.title}</Text>
              {!!r.sub && <Text style={op.rowMeta} numberOfLines={1}>{r.sub}</Text>}
            </View>
            {!!r.miss && (
              <View style={op.missBadge}>
                <Text style={op.missText}>{r.miss}</Text>
              </View>
            )}
          </Row>
        );
      })}
    </ResolveShell>
  );
}

// ═══ REVIEW DRAFT — AI diff, approve / edit ═══════════════════════════════
function OP_DataReview({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const d = c.diff || {};
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="review"
      title={c.title || 'Review draft'}
      note={c.note || 'AI draft'}
      topInset={topInset}
      onBack={onBack}
      primary="Approve"
      primaryIcon="check"
      alt="Discard & write my own"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Thumb uri={c.itemImage} size={32} radius={7} />
        <Text style={op.reviewName} numberOfLines={1}>{c.itemTitle}</Text>
        <View style={op.aiBadge}>
          <MaterialCommunityIcons name="auto-fix" size={11} color="#fff" />
          <Text style={op.aiText}>AI</Text>
        </View>
      </View>

      {!!d.titleNew && (
        <View>
          <Text style={op.diffLabel}>TITLE</Text>
          {!!d.titleOld && <Text style={op.diffOld}>{d.titleOld}</Text>}
          <View style={op.diffNew}>
            <Text style={op.diffNewText}>{d.titleNew}</Text>
          </View>
        </View>
      )}
      {!!d.descNew && (
        <View>
          <Text style={op.diffLabel}>DESCRIPTION · new</Text>
          <View style={op.diffNew}>
            <Text style={op.diffNewBody}>{d.descNew}</Text>
          </View>
        </View>
      )}
      <View style={op.editHint}>
        <MaterialCommunityIcons name="pencil" size={12} color={RC.muted} />
        <Text style={op.editHintText}>tap a field to edit</Text>
      </View>
    </ResolveShell>
  );
}

// ═══ FILL THE GAPS — manual fields AI can't guess ═════════════════════════
function OP_Manual({ c, idx, total, topInset, onBack, onResolve }: RProps) {
  const fields = c.fields || [];
  const missingRequired = fields.filter((f) => f.required && !f.value).map((f) => f.label);
  const ready = missingRequired.length === 0;
  // Render required fields full-width; pair up the short numeric ones.
  return (
    <ResolveShell
      idx={idx}
      total={total}
      kind="manual"
      title={c.title || 'Fill the gaps'}
      note={c.note || 'Can’t auto-guess'}
      topInset={topInset}
      onBack={onBack}
      primary="Save & next"
      primaryIcon="check"
      primaryReady={ready}
      primaryGate={missingRequired.length ? `${missingRequired[0]} still empty` : undefined}
      alt="Skip this item"
      onPrimary={() => onResolve('primary')}
      onAlt={() => onResolve('alt')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Thumb uri={c.itemImage} size={32} radius={7} />
        <View style={{ minWidth: 0 }}>
          <Text style={op.reviewName} numberOfLines={1}>{c.itemTitle}</Text>
          {!!c.itemSub && <Text style={[op.rowMeta, { color: RC.danger }]} numberOfLines={1}>{c.itemSub}</Text>}
        </View>
      </View>
      {chunkFields(fields).map((group, gi) =>
        group.length === 1 ? (
          <Field key={gi} {...group[0]} />
        ) : (
          <View key={gi} style={{ flexDirection: 'row', gap: 8 }}>
            {group.map((f, fi) => (
              <Field key={fi} {...f} half />
            ))}
          </View>
        ),
      )}
    </ResolveShell>
  );
}

// pair consecutive half-width fields, keep full-width ones alone
function chunkFields(fields: OptimizeFieldSpec[]): OptimizeFieldSpec[][] {
  const out: OptimizeFieldSpec[][] = [];
  let buf: OptimizeFieldSpec[] = [];
  for (const f of fields) {
    if (f.half) {
      buf.push(f);
      if (buf.length === 2) {
        out.push(buf);
        buf = [];
      }
    } else {
      if (buf.length) {
        out.push(buf);
        buf = [];
      }
      out.push([f]);
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

const REGISTRY: Record<OptimizeKind, (p: RProps) => React.ReactElement> = {
  photobad: OP_PhotoBad,
  datachoose: OP_DataChoose,
  dataselect: OP_DataSelect,
  datareview: OP_DataReview,
  manual: OP_Manual,
};

export function OptimizeResolver(props: RProps) {
  const Comp = REGISTRY[props.c.kind] || OP_Manual;
  return <Comp {...props} />;
}

const op = StyleSheet.create({
  badPhoto: { width: '100%', height: 80, borderRadius: 8, backgroundColor: RC.dangerSoft, borderWidth: 1.4, borderStyle: 'dashed', borderColor: RC.danger, alignItems: 'center', justifyContent: 'center' },
  photoCap: { fontSize: 11, fontWeight: '600', color: RC.muted },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  fieldChip: { backgroundColor: RC.greenSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  fieldChipText: { fontSize: 10, fontWeight: '700', color: RC.greenDark },

  selHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selCount: { fontSize: 12.5, fontWeight: '700', color: RC.ink },
  selAll: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  selAllText: { fontSize: 12, fontWeight: '600', color: RC.muted },
  rowTitle: { fontSize: 13, fontWeight: '700', color: RC.ink },
  rowMeta: { fontSize: 11, fontWeight: '500', color: RC.muted, marginTop: 1 },
  missBadge: { backgroundColor: RC.warnSoft, borderWidth: 1, borderColor: RC.warnLine, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  missText: { fontSize: 10, fontWeight: '700', color: RC.warnInk },

  reviewName: { flex: 1, fontSize: 14, fontWeight: '700', color: RC.ink },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: RC.greenDark, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  aiText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  diffLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: RC.muted, marginBottom: 4 },
  diffOld: { fontSize: 12, fontWeight: '500', color: RC.muted, textDecorationLine: 'line-through', marginBottom: 4 },
  diffNew: { backgroundColor: RC.greenSoft, borderLeftWidth: 3, borderLeftColor: RC.green, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 7 },
  diffNewText: { fontSize: 13, fontWeight: '700', color: RC.greenDark },
  diffNewBody: { fontSize: 12.5, fontWeight: '500', color: RC.ink2, lineHeight: 18 },
  editHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  editHintText: { fontSize: 11, fontWeight: '500', color: RC.muted },
});
