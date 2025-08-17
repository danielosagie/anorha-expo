import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type Item = {
  index: number;
  title: string;
  thumb?: string;
  matchesCount: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  items: Item[];
  currentIndex: number;
  // Status providers use color strings; prefer dark gray when pending
  scanColor: (index: number) => string; // '#10B981' green, '#EF4444' red, '#4B5563' dark gray
  matchColor: (index: number) => string;
  detailsColor: (index: number) => string;
  detailsEnabled: (index: number) => boolean;
  onPickScan: (index: number) => void;
  onPickMatch: (index: number) => void;
  onPickDetails: (index: number) => void;
  onQuickGenerate?: (index: number) => void;
  enableMultiSelect?: boolean;
  onBatchGenerateSelected?: (indices: number[]) => void;
  onBatchRescanSelected?: (indices: number[]) => void;
  onRescan?: (index: number) => void;
};

export default function ItemJobsModal({
  visible,
  onClose,
  items,
  currentIndex,
  scanColor,
  matchColor,
  detailsColor,
  detailsEnabled,
  onPickScan,
  onPickMatch,
  onPickDetails,
  onQuickGenerate,
  enableMultiSelect,
  onBatchGenerateSelected,
  onBatchRescanSelected,
  onRescan,
  }: Props) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allIndices = useMemo(() => items.map(it => it.index), [items]);
  const toggleIndex = (idx: number) => setSelected(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  const selectAll = () => setSelected(new Set(allIndices));
  const clearAll = () => setSelected(new Set());
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onClose}>
              <Icon name="close" size={22} color="#000" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Current Jobs</Text>
            {enableMultiSelect ? (
              <TouchableOpacity style={styles.headerBtn} onPress={() => { setSelectMode(s => !s); if (selectMode) clearAll(); }}>
                <Text style={{ color: '#000', fontWeight: '600' }}>{selectMode ? 'Done' : 'Select'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 24 }} />
            )}
          </View>

          <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
            {items.length === 0 && (
              <View style={{ paddingVertical: 12 }}>
                <Text style={{ color: '#000' }}>No items available.</Text>
              </View>
            )}

            {items.map((it) => (
              <TouchableOpacity
                key={`item-${it.index}`}
                onPress={() => onPickScan(it.index)}
                style={[styles.card, { backgroundColor: it.index === currentIndex ? 'rgba(147,200,34,0.08)' : '#fff' }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {selectMode && (
                    <TouchableOpacity onPress={() => toggleIndex(it.index)} style={{ marginRight: 8 }}>
                      <Icon name={selected.has(it.index) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={selected.has(it.index) ? '#93C822' : '#888'} />
                    </TouchableOpacity>
                  )}
                  {!!it.thumb && <Image source={{ uri: it.thumb }} style={{ width: 36, height: 36, borderRadius: 6, marginRight: 10 }} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{it.title}</Text>
                    <Text style={{ color: '#000' }}>Matches: {it.matchesCount}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 6 }}>
                      {/* Scan */}
                      <TouchableOpacity onPress={() => onPickScan(it.index)} style={styles.pill}>
                        <View style={[styles.dot, { backgroundColor: scanColor(it.index) }]} />
                        <Text style={styles.pillText}>Scan</Text>
                      </TouchableOpacity>
                      {/* Match */}
                      <TouchableOpacity onPress={() => onPickMatch(it.index)} style={styles.pill}>
                        <View style={[styles.dot, { backgroundColor: matchColor(it.index) }]} />
                        <Text style={styles.pillText}>Match</Text>
                      </TouchableOpacity>
                       {/* Rescan - only show when matchesCount === 0 (initial SerpAPI scan failed) */}
                       {onRescan && it.matchesCount === 0 ? (
                        <TouchableOpacity onPress={() => onRescan(it.index)} style={styles.pill}>
                          <Icon name="camera-refresh" size={14} color="#000" />
                          <Text style={styles.pillText}>Rescan</Text>
                        </TouchableOpacity>
                       ) : null}
                      {/* Details vs Generate (toggle based on detailsEnabled) */}
                      {detailsEnabled(it.index) ? (
                        <TouchableOpacity onPress={() => onPickDetails(it.index)} style={styles.pill}>
                          <View style={[styles.dot, { backgroundColor: detailsColor(it.index) }]} />
                          <Text style={styles.pillText}>Details</Text>
                        </TouchableOpacity>
                      ) : (
                        onQuickGenerate ? (
                          <TouchableOpacity onPress={() => onQuickGenerate(it.index)} style={styles.pill}>
                            <Icon name="rocket-launch-outline" size={14} color="#000" />
                            <Text style={styles.pillText}>Generate</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.pill, { opacity: 0.5 }]}>
                            <Icon name="rocket-launch-outline" size={14} color="#888" />
                            <Text style={styles.pillText}>Generate</Text>
                          </View>
                        )
                      )}
                    </View>
                  </View>
                  {it.index === currentIndex && <Icon name="check-circle" size={18} color="#93C822" />}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {enableMultiSelect && selectMode && (
            <View style={styles.footerBar}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity onPress={selected.size === items.length ? clearAll : selectAll}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>{selected.size === items.length ? 'Clear all' : 'Select all'}</Text>
                </TouchableOpacity>
                <Text style={{ color: '#000' }}>| Selected: {selected.size}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {onBatchRescanSelected ? (
                  <TouchableOpacity disabled={selected.size === 0} onPress={() => onBatchRescanSelected(Array.from(selected))} style={[styles.footerBtn, selected.size === 0 && { opacity: 0.5 }]}>
                    <Icon name="reload" size={16} color="#fff" />
                    <Text style={styles.footerBtnText}>Rescan {selected.size > 0 ? `(${selected.size})` : ''}</Text>
                  </TouchableOpacity>
                ) : null}
                {onBatchGenerateSelected ? (
                  <TouchableOpacity disabled={selected.size === 0} onPress={() => onBatchGenerateSelected(Array.from(selected))} style={[styles.footerBtn, selected.size === 0 && { opacity: 0.5 }]}>
                    <Icon name="rocket-launch-outline" size={16} color="#fff" />
                    <Text style={styles.footerBtnText}>Generate {selected.size > 0 ? `(${selected.size})` : ''}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingBottom: 20,
    minHeight: '50%',
    maxHeight: '70%',
    height: '70%',
    position: 'absolute',
    bottom: 90,
    left: 10,
    right: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  headerBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginBottom: 8 },
  title: { color: '#000', fontWeight: '600' },
  pill: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 8, marginRight: 6, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: '#000', marginLeft: 6 },
  footerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#E5E5E5' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#93C822', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  footerBtnText: { color: '#fff', fontWeight: '600' },
});


