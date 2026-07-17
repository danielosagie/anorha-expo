// OptimizerReviewView — the optimize "review" step.
//
// Product-detail style, one item at a time: tap any field to edit (saved through
// the canonical product API), a per-channel readiness pill row (red count of gaps → green
// check when ready), ‹ Item N › nav and a progress bar. Replaces the old
// display-only "fill the gaps" resolver, which never persisted edits.
//
// v1 readiness is variant-level (title · SKU · description) shared across the
// connected channels; when true per-platform field requirements are wired the
// pills diverge per channel without touching this UI.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { RC } from '../resolve/ResolveKit';
import { normalizeDisplayName } from '../../config/platforms';
import { ClassifiedProduct, OPTIMIZER_THRESHOLDS } from '../../hooks/useOptimizerQueues';
import { createLogger } from '../../utils/logger';

const log = createLogger('OptimizerReviewView');

type FieldKey = 'Title' | 'Sku' | 'Description';
interface FieldDef { key: FieldKey; label: string; multiline?: boolean; placeholder: string; }
const FIELDS: FieldDef[] = [
  { key: 'Title', label: 'Title', placeholder: 'Product title' },
  { key: 'Sku', label: 'SKU', placeholder: 'e.g. LAV-04' },
  { key: 'Description', label: 'Description', multiline: true, placeholder: 'Describe the item' },
];

interface Props {
  products: ClassifiedProduct[];
  platforms: string[];
  onBack: () => void;
  onComplete: (ids: string[]) => void;
}

const firstImage = (p?: ClassifiedProduct): string | null => {
  const imgs = (p?.ProductImages as any[]) || [];
  return imgs[0]?.ImageUrl || imgs[0]?.imageUrl || null;
};

const OptimizerReviewView: React.FC<Props> = ({ products, platforms, onBack, onComplete }) => {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [edits, setEdits] = useState<Record<string, Partial<Record<FieldKey, string>>>>({});
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [scoped, setScoped] = useState<string | null>(null);
  const [editing, setEditing] = useState<FieldDef | null>(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const total = products.length;
  const cur = products[Math.min(idx, Math.max(total - 1, 0))];
  const curId = cur?.Id;

  const val = useCallback(
    (key: FieldKey): string => (curId ? edits[curId]?.[key] : undefined) ?? ((cur as any)?.[key] || ''),
    [edits, cur, curId],
  );

  const missing = useMemo(() => {
    const out: FieldKey[] = [];
    if ((val('Title') || '').trim().length < OPTIMIZER_THRESHOLDS.minTitleLength) out.push('Title');
    if (!(val('Sku') || '').trim()) out.push('Sku');
    if ((val('Description') || '').length < OPTIMIZER_THRESHOLDS.minDescriptionLength) out.push('Description');
    return out;
  }, [val]);
  const missingCount = missing.length;

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    async (key: FieldKey, value: string) => {
      if (!curId) return;
      setEdits((prev) => ({ ...prev, [curId]: { ...prev[curId], [key]: value } }));
      setSaveState('saving');
      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('You’re signed out.');
        const response = await fetch(`${API_BASE_URL}/api/products/${curId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ [key]: value }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(body || `Save failed (${response.status})`);
        }
        setSaveState('saved');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setSaveState('idle'), 2500);
      } catch (e) {
        log.error('[OptimizerReview] save failed', e);
        setSaveState('error');
      }
    },
    [curId],
  );

  const openEdit = (f: FieldDef) => {
    setDraft(val(f.key));
    setEditing(f);
  };
  const commitEdit = () => {
    if (editing) persist(editing.key, draft.trim());
    setEditing(null);
  };

  const next = () => {
    if (curId) setReviewed((prev) => new Set([...prev, curId]));
    if (idx + 1 < total) setIdx(idx + 1);
    else onComplete([...reviewed, ...(curId ? [curId] : [])]);
  };
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  if (!cur) {
    return (
      <View style={[s.screen, { paddingTop: insets.top + 40 }]}>
        <Text style={s.emptyText}>Nothing to review.</Text>
        <TouchableOpacity style={s.primary} onPress={() => onComplete([])}><Text style={s.primaryText}>Done</Text></TouchableOpacity>
      </View>
    );
  }

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : '';
  const cover = firstImage(cur);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8} style={s.iconBtn}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={RC.muted} />
        </TouchableOpacity>
        <View style={s.navRow}>
          <TouchableOpacity onPress={prev} disabled={idx === 0} hitSlop={8} style={[s.navBtn, idx === 0 && s.navBtnDim]}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={idx === 0 ? RC.faint : RC.ink} />
          </TouchableOpacity>
          <Text style={s.navText}>Item {idx + 1} of {total}</Text>
          <TouchableOpacity onPress={() => idx + 1 < total && setIdx(idx + 1)} disabled={idx + 1 >= total} hitSlop={8} style={[s.navBtn, idx + 1 >= total && s.navBtnDim]}>
            <MaterialCommunityIcons name="chevron-right" size={18} color={idx + 1 >= total ? RC.faint : RC.ink} />
          </TouchableOpacity>
        </View>
        <View style={{ width: 36, alignItems: 'flex-end' }}>
          {!!saveLabel && (
            <Text style={[s.save, saveState === 'error' && { color: RC.danger }]} numberOfLines={1}>{saveLabel}</Text>
          )}
        </View>
      </View>

      <View style={s.progress}>
        {products.map((p) => (
          <View key={p.Id} style={[s.progSeg, reviewed.has(p.Id) && s.progSegOn]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.itemRow}>
          {cover ? <Image source={{ uri: cover }} style={s.cover} /> : <View style={s.cover}><MaterialCommunityIcons name="image-outline" size={24} color={RC.faint} /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.itemTitle} numberOfLines={2}>{val('Title') || 'Untitled item'}</Text>
            <Text style={s.itemSub} numberOfLines={1}>{val('Sku') ? `SKU ${val('Sku')}` : 'tap a field to edit'}</Text>
          </View>
        </View>

        {platforms.length > 0 && (
          <>
            <Text style={s.lbl}>READY ON</Text>
            <View style={s.pills}>
              {platforms.slice(0, 4).map((p) => {
                const ready = missingCount === 0;
                const on = scoped === p;
                return (
                  <TouchableOpacity
                    key={p}
                    activeOpacity={0.85}
                    onPress={() => setScoped(on ? null : p)}
                    style={[s.pill, ready ? s.pillReady : s.pillGap, on && s.pillOn]}
                  >
                    {ready ? (
                      <View style={s.pillDotGreen}><MaterialCommunityIcons name="check" size={11} color="#fff" /></View>
                    ) : (
                      <View style={s.pillDotRed}><Text style={s.pillDotNum}>{missingCount}</Text></View>
                    )}
                    <Text style={s.pillText} numberOfLines={1}>{normalizeDisplayName(p)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <View style={s.fields}>
          {FIELDS.map((f) => {
            const v = val(f.key);
            const isMissing = missing.includes(f.key);
            return (
              <TouchableOpacity key={f.key} activeOpacity={0.7} onPress={() => openEdit(f)} style={s.fieldRow}>
                <Text style={s.fieldLabel}>{f.label}</Text>
                {isMissing && !v ? (
                  <Text style={s.fieldAdd}>Add</Text>
                ) : (
                  <Text style={s.fieldValue} numberOfLines={1}>{v || '—'}</Text>
                )}
                <MaterialCommunityIcons name="chevron-right" size={18} color={RC.faint} />
              </TouchableOpacity>
            );
          })}
        </View>

        {missingCount > 0 && (
          <View style={s.banner}>
            <MaterialCommunityIcons name="alert-outline" size={15} color={RC.warnInk} />
            <Text style={s.bannerText}>Missing: {missing.map((m) => (m === 'Sku' ? 'SKU' : m)).join(', ')}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity activeOpacity={0.9} onPress={next} style={s.primary}>
          <Text style={s.primaryText}>{idx + 1 < total ? 'Looks good · next' : 'Finish review'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={s.sheetOverlay} onPress={() => setEditing(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
              <View style={s.sheetHandle} />
              <View style={s.sheetHead}>
                <Text style={s.sheetTitle}>{editing?.label}</Text>
                <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8} style={s.iconBtn}>
                  <MaterialCommunityIcons name="close" size={18} color={RC.muted} />
                </TouchableOpacity>
              </View>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={editing?.placeholder}
                placeholderTextColor={RC.faint}
                style={[s.input, editing?.multiline && s.inputMulti]}
                multiline={!!editing?.multiline}
                autoFocus
              />
              <TouchableOpacity activeOpacity={0.9} onPress={commitEdit} style={s.primary}>
                <Text style={s.primaryText}>Save</Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {saveState === 'saving' && (
        <View style={s.savingDot}><ActivityIndicator size="small" color={RC.green} /></View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  emptyText: { fontSize: 14, color: RC.muted, textAlign: 'center', marginBottom: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  navRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  navBtnDim: { opacity: 0.4 },
  navText: { fontSize: 15, fontWeight: '700', color: RC.ink, fontVariant: ['tabular-nums'] },
  save: { fontSize: 12.5, fontWeight: '600', color: RC.green },

  progress: { flexDirection: 'row', gap: 4, marginTop: 10 },
  progSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: RC.line },
  progSegOn: { backgroundColor: RC.green },

  scroll: { paddingTop: 14, paddingBottom: 20 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cover: { width: 60, height: 60, borderRadius: 14, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemTitle: { fontSize: 17, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  itemSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 3 },

  lbl: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: RC.faint, marginTop: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, paddingVertical: 6, paddingLeft: 7, paddingRight: 12, borderWidth: 1 },
  pillReady: { borderColor: RC.greenLine, backgroundColor: '#F6FCEC' },
  pillGap: { borderColor: '#FECACA', backgroundColor: '#fff' },
  pillOn: { borderColor: RC.ink, borderWidth: 2, paddingVertical: 5 },
  pillDotGreen: { width: 18, height: 18, borderRadius: 9, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center' },
  pillDotRed: { width: 18, height: 18, borderRadius: 9, backgroundColor: RC.danger, alignItems: 'center', justifyContent: 'center' },
  pillDotNum: { fontSize: 11, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  pillText: { fontSize: 13.5, fontWeight: '700', color: RC.ink },

  fields: { marginTop: 18 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: 1, borderColor: '#F1F2F4', paddingVertical: 9 },
  fieldLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: RC.muted },
  fieldValue: { fontSize: 14, fontWeight: '600', color: RC.ink, maxWidth: 180, textAlign: 'right' },
  fieldAdd: { fontSize: 14, fontWeight: '700', color: RC.danger },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: RC.warnSoft, borderWidth: 1, borderColor: RC.warnLine, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: RC.warnInk },

  footer: { paddingTop: 10 },
  primary: { height: 52, borderRadius: 14, backgroundColor: RC.green, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: RC.line, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  input: { borderWidth: 1.5, borderColor: RC.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: RC.ink, minHeight: 50 },
  inputMulti: { minHeight: 120, textAlignVertical: 'top' },

  savingDot: { position: 'absolute', top: 56, right: 18 },
});

export default OptimizerReviewView;
