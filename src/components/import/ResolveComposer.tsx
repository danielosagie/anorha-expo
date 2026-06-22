// ResolveComposer — the edit / explain surface for a Match card.
//
// One reusable bottom sheet, two modes:
//   • explain — quick reason chips + a prominent note ("why aren't they the
//     same?"). Submitting records the reason and keeps the items separate.
//   • edit — fix the incoming title / price / SKU before deciding.
//
// Modeled on the email-composer reference: an item header, the body, a quiet
// undo/redo toolbar, and one prominent input + confirm. Light-theme to match
// the rest of the app (ResolveKit tokens).

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RC, Thumb } from '../resolve/ResolveKit';

export type ComposerMode = 'explain' | 'edit';

export interface ComposerField {
  key: string;
  label: string;
  value: string;
  keyboardType?: 'default' | 'decimal-pad' | 'numeric';
}

export interface ComposerResult {
  note?: string;
  tags?: string[];
  fields?: Record<string, string>;
}

interface ResolveComposerProps {
  visible: boolean;
  mode: ComposerMode;
  item: { title: string; sub?: string; imageUrl?: string | null };
  /** explain mode: quick toggleable reasons. */
  reasonChips?: string[];
  initialNote?: string;
  /** edit mode: the fields to edit. */
  fields?: ComposerField[];
  onCancel: () => void;
  onSubmit: (result: ComposerResult) => void;
}

const DEFAULT_CHIPS = ['Different size', 'Different scent', 'Different color', 'Wrong item', 'Different bundle'];

const ResolveComposer: React.FC<ResolveComposerProps> = ({
  visible,
  mode,
  item,
  reasonChips,
  initialNote,
  fields,
  onCancel,
  onSubmit,
}) => {
  const chips = reasonChips && reasonChips.length ? reasonChips : DEFAULT_CHIPS;
  const [tags, setTags] = useState<string[]>([]);
  // Simple text history so the toolbar's undo/redo is real, not decorative.
  const [note, setNote] = useState(initialNote || '');
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});

  // Reset every time the sheet opens for a fresh item/mode.
  useEffect(() => {
    if (!visible) return;
    setTags([]);
    setNote(initialNote || '');
    past.current = [];
    future.current = [];
    setVals(Object.fromEntries((fields || []).map((f) => [f.key, f.value])));
  }, [visible, mode, initialNote, fields]);

  const pushNote = (next: string) => {
    past.current.push(note);
    future.current = [];
    setNote(next);
  };
  const undo = () => {
    if (mode === 'edit') {
      setVals(Object.fromEntries((fields || []).map((f) => [f.key, f.value]))); // reset edits
      return;
    }
    if (!past.current.length) return;
    future.current.push(note);
    setNote(past.current.pop() as string);
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(note);
    setNote(future.current.pop() as string);
  };

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const canSubmit = mode === 'explain' ? tags.length > 0 || note.trim().length > 0 : true;

  const submit = () => {
    if (mode === 'explain') onSubmit({ note: note.trim() || undefined, tags });
    else onSubmit({ fields: vals });
  };

  const title = mode === 'explain' ? 'Why aren’t they the same?' : 'Edit details';
  const primaryLabel = mode === 'explain' ? 'Save & keep separate' : 'Save changes';
  const primaryIcon = mode === 'explain' ? 'content-save-outline' : 'check';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.handle} />

            {/* Item header */}
            <View style={s.itemRow}>
              <Thumb uri={item.imageUrl} size={36} radius={9} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text>
                {!!item.sub && <Text style={s.itemSub} numberOfLines={1}>{item.sub}</Text>}
              </View>
              <TouchableOpacity onPress={onCancel} hitSlop={10} style={s.closeBtn}>
                <MaterialCommunityIcons name="close" size={18} color={RC.muted} />
              </TouchableOpacity>
            </View>

            <Text style={s.title}>{title}</Text>

            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {mode === 'explain' ? (
                <>
                  <View style={s.chipsWrap}>
                    {chips.map((c) => {
                      const on = tags.includes(c);
                      return (
                        <TouchableOpacity
                          key={c}
                          onPress={() => toggleTag(c)}
                          activeOpacity={0.8}
                          style={[s.chip, on && { borderColor: RC.green, backgroundColor: RC.greenSoft }]}
                        >
                          <Text style={[s.chipText, on && { color: RC.greenDark }]}>{c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    value={note}
                    onChangeText={pushNote}
                    placeholder="Add a note — what’s actually different?"
                    placeholderTextColor={RC.faint}
                    style={s.noteInput}
                    multiline
                  />
                </>
              ) : (
                <View style={{ gap: 12 }}>
                  {(fields || []).map((f) => (
                    <View key={f.key}>
                      <Text style={s.fieldLabel}>{f.label.toUpperCase()}</Text>
                      <TextInput
                        value={vals[f.key] ?? ''}
                        onChangeText={(t) => setVals((p) => ({ ...p, [f.key]: t }))}
                        placeholder={f.label}
                        placeholderTextColor={RC.faint}
                        keyboardType={f.keyboardType || 'default'}
                        style={s.fieldInput}
                      />
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Quiet toolbar — undo / redo (edit: reset) */}
            <View style={s.toolbar}>
              <TouchableOpacity onPress={undo} hitSlop={8} style={s.toolBtn}>
                <MaterialCommunityIcons name="undo-variant" size={18} color={RC.muted} />
              </TouchableOpacity>
              {mode === 'explain' && (
                <TouchableOpacity onPress={redo} hitSlop={8} style={s.toolBtn}>
                  <MaterialCommunityIcons name="redo-variant" size={18} color={RC.muted} />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }} />
              <Text style={s.toolHint}>{mode === 'explain' ? 'Optional — helps next time' : 'Edits apply on commit'}</Text>
            </View>

            <TouchableOpacity
              onPress={submit}
              disabled={!canSubmit}
              activeOpacity={0.88}
              style={[s.primaryBtn, !canSubmit && s.primaryBtnDim]}
            >
              <MaterialCommunityIcons name={primaryIcon as any} size={18} color={canSubmit ? '#fff' : RC.faint} />
              <Text style={[s.primaryText, !canSubmit && { color: RC.faint }]}>{primaryLabel}</Text>
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingBottom: 28, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: RC.line, alignSelf: 'center', marginBottom: 14 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: RC.ink },
  itemSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center' },

  title: { fontSize: 20, fontWeight: '700', color: RC.ink, letterSpacing: -0.3, marginBottom: 14 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#fff' },
  chipText: { fontSize: 13.5, fontWeight: '600', color: RC.ink2 },

  noteInput: { minHeight: 96, borderWidth: 1.5, borderColor: RC.line, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: '500', color: RC.ink, textAlignVertical: 'top' },

  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: RC.muted, marginBottom: 5 },
  fieldInput: { minHeight: 48, borderWidth: 1.5, borderColor: RC.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, fontWeight: '500', color: RC.ink },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 12 },
  toolBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: RC.surface, borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  toolHint: { fontSize: 12.5, fontWeight: '500', color: RC.faint },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: RC.green },
  primaryBtnDim: { backgroundColor: RC.surface2 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default ResolveComposer;
