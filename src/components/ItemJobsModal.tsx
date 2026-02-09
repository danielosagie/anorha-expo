/**
 * ItemJobsModal - A stepper modal for tracking multi-item job progress
 * 
 * Shows all items in the current job flow with real-time status for each step:
 * Scan → Match → Generate → Details
 * 
 * Features:
 * - Switch between items
 * - See real-time progress for each step
 * - Initiate, retry, or skip steps
 * - Batch operations for multiple items
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Animated, Easing, TextInput
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ItemJobState, StepStatus } from '../hooks/useJobsState';

// Anorha green - same as selected match, done states across the app
const ANORHA_GREEN = '#93C822';

// Step configuration
const STEPS = [
  { key: 'scan', label: 'Scan', icon: 'camera' },
  { key: 'match', label: 'Match', icon: 'magnify' },
  { key: 'generate', label: 'Generate', icon: 'creation' },
  { key: 'details', label: 'Details', icon: 'file-document-edit' },
] as const;

type StepKey = typeof STEPS[number]['key'];

// Legacy props interface for backward compatibility
type LegacyItem = {
  index: number;
  title: string;
  thumb?: string;
  matchesCount: number;
};

type LegacyProps = {
  visible: boolean;
  onClose: () => void;
  items: LegacyItem[];
  currentIndex: number;
  scanColor: (index: number) => string;
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
  countLabel?: string;
  getSecondaryText?: (index: number) => string | null;
};

// New enhanced props interface
type EnhancedProps = {
  visible: boolean;
  onClose: () => void;
  items: ItemJobState[];
  currentIndex: number;
  onItemSelect: (index: number) => void;
  onStepPress: (index: number, step: StepKey) => void;
  onStartStep?: (index: number, step: 'match' | 'generate') => void;
  onRetryStep?: (index: number, step: 'match' | 'generate') => void;
  enableMultiSelect?: boolean;
  onBatchGenerate?: (indices: number[]) => void;
  onBatchRescan?: (indices: number[]) => void;
  getSubstepText?: (index: number, step: StepKey) => string | null;
  isEnhanced: true;
};

type Props = LegacyProps | EnhancedProps;

function isEnhancedProps(props: Props): props is EnhancedProps {
  return 'isEnhanced' in props && props.isEnhanced === true;
}

// Spinning loader animation component
const SpinningLoader: React.FC<{ size?: number; color?: string }> = ({
  size = 12,
  color = '#FFD700'
}) => {
  const spinValue = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Icon name="loading" size={size} color={color} />
    </Animated.View>
  );
};

// Status indicator component
const StatusIndicator: React.FC<{ status: StepStatus; size?: number }> = ({
  status,
  size = 14
}) => {
  switch (status) {
    case 'completed':
      return <Icon name="check-circle" size={size} color={ANORHA_GREEN} />;
    case 'processing':
    case 'queued':
      return <SpinningLoader size={size} color="#FFD700" />;
    case 'failed':
      return <Icon name="alert-circle" size={size} color="#EF4444" />;
    case 'skipped':
      return <Icon name="minus-circle" size={size} color="#9CA3AF" />;
    case 'pending':
    default:
      return <View style={[styles.pendingDot, { width: size * 0.6, height: size * 0.6 }]} />;
  }
};

// Step pill component for enhanced mode
const StepPill: React.FC<{
  step: typeof STEPS[number];
  status: StepStatus;
  isActive: boolean;
  onPress: () => void;
  progressText?: string | null;
}> = ({ step, status, isActive, onPress, progressText }) => {
  const isClickable = status !== 'pending' || step.key === 'scan';

  return (
    <TouchableOpacity
      onPress={isClickable ? onPress : undefined}
      style={[
        styles.stepPill,
        isActive && styles.stepPillActive,
        !isClickable && styles.stepPillDisabled,
      ]}
      activeOpacity={isClickable ? 0.7 : 1}
    >
      <StatusIndicator status={status} size={14} />
      <View style={styles.stepPillContent}>
        <Text style={[
          styles.stepPillLabel,
          isActive && styles.stepPillLabelActive,
          !isClickable && styles.stepPillLabelDisabled,
        ]}>
          {step.label}
        </Text>
        {progressText && (status === 'processing' || status === 'queued') && (
          <Text style={styles.stepPillProgress} numberOfLines={1}>
            {progressText}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// Legacy step pill for backward compatibility
const LegacyStepPill: React.FC<{
  label: string;
  color: string;
  onPress: () => void;
  icon?: string;
}> = ({ label, color, onPress, icon }) => (
  <TouchableOpacity onPress={onPress} style={styles.legacyPill}>
    {icon ? (
      <Icon name={icon} size={14} color="#000" />
    ) : (
      <View style={[styles.legacyDot, { backgroundColor: color }]} />
    )}
    <Text style={styles.legacyPillText}>{label}</Text>
  </TouchableOpacity>
);

// Item card component
const ItemCard: React.FC<{
  item: ItemJobState | LegacyItem;
  isSelected: boolean;
  isCurrent: boolean;
  isEnhanced: boolean;
  onSelect: () => void;
  onStepPress?: (step: StepKey) => void;
  getStepStatus?: (step: StepKey) => StepStatus;
  getProgressText?: (step: StepKey) => string | null;
  // Legacy props
  scanColor?: string;
  matchColor?: string;
  detailsColor?: string;
  detailsEnabled?: boolean;
  onPickScan?: () => void;
  onPickMatch?: () => void;
  onPickDetails?: () => void;
  onQuickGenerate?: () => void;
  onRescan?: () => void;
  countLabel?: string;
  secondaryText?: string | null;
  selectMode?: boolean;
  onToggleSelect?: () => void;
}> = (props) => {
  const {
    item, isSelected, isCurrent, isEnhanced, onSelect, selectMode, onToggleSelect
  } = props;

  // Extract properties with proper type handling
  const itemAsLegacy = item as LegacyItem;
  const itemAsEnhanced = item as ItemJobState;

  const title = itemAsLegacy.title || `Item ${itemAsLegacy.index + 1}`;
  const thumb = itemAsLegacy.thumb || itemAsEnhanced.thumb;
  const matchesCount = 'matchesCount' in item
    ? itemAsLegacy.matchesCount
    : itemAsEnhanced.match?.matchesCount || 0;

  return (
    <TouchableOpacity
      onPress={selectMode ? onToggleSelect : onSelect}
      style={[
        styles.card,
        isCurrent && styles.cardCurrent,
      ]}
    >
      <View style={styles.cardHeader}>
        {selectMode && (
          <TouchableOpacity onPress={onToggleSelect} style={styles.checkbox}>
            <Icon
              name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={20}
              color={isSelected ? ANORHA_GREEN : '#888'}
            />
          </TouchableOpacity>
        )}

        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.cardThumb} />
        ) : (
          <View style={[styles.cardThumb, styles.cardThumbPlaceholder]}>
            <Icon name="image-off" size={20} color="#9CA3AF" />
          </View>
        )}

        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.cardMeta}>
            {props.countLabel || 'Matches'}: {matchesCount}
          </Text>
          {props.secondaryText && (
            <Text style={styles.cardSecondary}>{props.secondaryText}</Text>
          )}
        </View>

        {isCurrent && !selectMode && (
          <Icon name="check-circle" size={18} color={ANORHA_GREEN} />
        )}
      </View>

      {/* Step Pills */}
      <View style={styles.stepsRow}>
        {isEnhanced && props.getStepStatus && props.onStepPress ? (
          // Enhanced mode - show all steps with real status
          STEPS.map((step) => (
            <StepPill
              key={step.key}
              step={step}
              status={props.getStepStatus!(step.key)}
              isActive={isCurrent}
              onPress={() => props.onStepPress!(step.key)}
              progressText={props.getProgressText?.(step.key)}
            />
          ))
        ) : (
          // Legacy mode - show scan/match/details with colors
          <>
            <LegacyStepPill
              label="Scan"
              color={props.scanColor || '#10B981'}
              onPress={props.onPickScan || (() => { })}
            />
            <LegacyStepPill
              label="Match"
              color={props.matchColor || '#4B5563'}
              onPress={props.onPickMatch || (() => { })}
            />
            {props.onRescan && matchesCount === 0 && (
              <LegacyStepPill
                label="Rescan"
                color="#4B5563"
                onPress={props.onRescan}
                icon="camera-refresh"
              />
            )}
            {props.detailsEnabled ? (
              <LegacyStepPill
                label="Details"
                color={props.detailsColor || '#4B5563'}
                onPress={props.onPickDetails || (() => { })}
              />
            ) : props.onQuickGenerate ? (
              <TouchableOpacity
                onPress={props.onQuickGenerate}
                style={styles.legacyPill}
              >
                <Icon name="rocket-launch-outline" size={14} color="#000" />
                <Text style={styles.legacyPillText}>Generate</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.legacyPill, { opacity: 0.5 }]}>
                <Icon name="rocket-launch-outline" size={14} color="#888" />
                <Text style={styles.legacyPillText}>Generate</Text>
              </View>
            )}
          </>
        )}
      </View>
    </TouchableOpacity>
  );
};

// Main modal component
export default function ItemJobsModal(props: Props) {
  const { visible, onClose } = props;
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');

  const enhanced = isEnhancedProps(props);
  const items = props.items;
  const currentIndex = props.currentIndex;

  const allIndices = useMemo(() => items.map(it => it.index), [items]);

  // Calculate status counts for queue summary
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    items.forEach(item => {
      if (enhanced) {
        const genStatus = (item as ItemJobState).generate?.status;
        if (genStatus === 'completed') counts.completed++;
        else if (genStatus === 'processing' || genStatus === 'queued') counts.processing++;
        else if (genStatus === 'failed') counts.failed++;
        else counts.pending++;
      } else {
        const legacyProps = props as LegacyProps;
        const detailsColor = legacyProps.detailsColor(item.index);
        if (detailsColor === ANORHA_GREEN) counts.completed++;
        else if (detailsColor === '#FFD700') counts.processing++;
        else if (detailsColor === '#e11d48' || detailsColor === '#EF4444') counts.failed++;
        else counts.pending++;
      }
    });
    return counts;
  }, [items, enhanced, props]);

  // Filter items by search and status
  const filteredItems = useMemo(() => {
    let result = [...items] as typeof items;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item => {
        const itemAsLegacy = item as LegacyItem;
        const title = itemAsLegacy.title || `Item ${item.index + 1}`;
        return title.toLowerCase().includes(query);
      }) as typeof items;
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(item => {
        if (enhanced) {
          const genStatus = (item as ItemJobState).generate?.status;
          if (statusFilter === 'pending') return !genStatus || genStatus === 'pending';
          if (statusFilter === 'processing') return genStatus === 'processing' || genStatus === 'queued';
          if (statusFilter === 'completed') return genStatus === 'completed';
          if (statusFilter === 'failed') return genStatus === 'failed';
        } else {
          const legacyProps = props as LegacyProps;
          const detailsColor = legacyProps.detailsColor(item.index);
          if (statusFilter === 'completed') return detailsColor === ANORHA_GREEN;
          if (statusFilter === 'processing') return detailsColor === '#FFD700';
          if (statusFilter === 'failed') return detailsColor === '#e11d48' || detailsColor === '#EF4444';
          if (statusFilter === 'pending') return !detailsColor || detailsColor === '#4B5563';
        }
        return true;
      }) as typeof items;
    }

    return result;
  }, [items, searchQuery, statusFilter, enhanced, props]);

  const toggleIndex = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filteredItems.map(i => i.index)));
  const clearAll = () => setSelected(new Set());

  const handleClose = () => {
    setSelectMode(false);
    clearAll();
    setSearchQuery('');
    setStatusFilter('all');
    onClose();
  };

  // Get step status - enhanced mode only
  const getStepStatus = (item: ItemJobState, step: StepKey): StepStatus => {
    return item[step].status;
  };

  // Get progress text - enhanced mode only
  const getProgressText = (item: ItemJobState, step: StepKey): string | null => {
    if (!enhanced) return null;
    const stepData = item[step];
    if ('currentStage' in stepData && stepData.currentStage) {
      return stepData.currentStage;
    }
    return null;
  };

  const enableMultiSelect = enhanced
    ? props.enableMultiSelect
    : (props as LegacyProps).enableMultiSelect;

  const hasBatchOperations = enhanced
    ? !!(props.onBatchGenerate || props.onBatchRescan)
    : !!((props as LegacyProps).onBatchGenerateSelected || (props as LegacyProps).onBatchRescanSelected);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={handleClose}>
              <Icon name="close" size={22} color="#000" />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>Current Jobs</Text>

            {enableMultiSelect && hasBatchOperations ? (
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={() => {
                  setSelectMode(s => !s);
                  if (selectMode) clearAll();
                }}
              >
                <Text style={styles.headerBtnText}>
                  {selectMode ? 'Done' : 'Select'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 50 }} />
            )}
          </View>

          {/* Search Bar - Only show when 5+ items */}
          {items.length >= 5 && (
            <View style={styles.searchContainer}>
              <Icon name="magnify" size={18} color="#9CA3AF" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search items..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
                  <Icon name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Queue Summary - Always show when items exist */}
          {items.length > 0 && (
            <View style={styles.queueSummary}>
              <Text style={styles.queueText}>
                {statusCounts.processing > 0 && (
                  <Text style={styles.queueProcessing}>{statusCounts.processing} processing</Text>
                )}
                {statusCounts.processing > 0 && statusCounts.pending > 0 && ' • '}
                {statusCounts.pending > 0 && (
                  <Text style={styles.queuePending}>{statusCounts.pending} pending</Text>
                )}
                {(statusCounts.processing > 0 || statusCounts.pending > 0) && statusCounts.completed > 0 && ' • '}
                {statusCounts.completed > 0 && (
                  <Text style={styles.queueComplete}>{statusCounts.completed} done</Text>
                )}
                {statusCounts.failed > 0 && ' • '}
                {statusCounts.failed > 0 && (
                  <Text style={styles.queueFailed}>{statusCounts.failed} failed</Text>
                )}
              </Text>
            </View>
          )}

          {/* Status Filter Tabs - Only show when 5+ items */}
          {items.length >= 5 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterTabsScroll}>
              <View style={styles.filterTabs}>
                {(['all', 'pending', 'processing', 'completed', 'failed'] as const).map(status => {
                  const count = status === 'all' ? items.length : statusCounts[status];
                  const isActive = statusFilter === status;
                  if (status !== 'all' && count === 0) return null;
                  return (
                    <TouchableOpacity
                      key={status}
                      onPress={() => setStatusFilter(status)}
                      style={[styles.filterTab, isActive && styles.filterTabActive]}
                    >
                      <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
                        {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
                        {count > 0 && ` (${count})`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* Items List */}
          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {filteredItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name={searchQuery ? "magnify-close" : "package-variant"} size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>
                  {searchQuery ? 'No items match your search' : 'No items in this job'}
                </Text>
              </View>
            ) : (
              filteredItems.map((item) => {
                const idx = item.index;

                if (enhanced) {
                  const enhancedItem = item as ItemJobState;
                  return (
                    <ItemCard
                      key={`item-${idx}`}
                      item={enhancedItem}
                      isSelected={selected.has(idx)}
                      isCurrent={idx === currentIndex}
                      isEnhanced={true}
                      onSelect={() => (props as EnhancedProps).onItemSelect(idx)}
                      onStepPress={(step) => (props as EnhancedProps).onStepPress(idx, step)}
                      getStepStatus={(step) => getStepStatus(enhancedItem, step)}
                      getProgressText={(step) => getProgressText(enhancedItem, step)}
                      selectMode={selectMode}
                      onToggleSelect={() => toggleIndex(idx)}
                    />
                  );
                } else {
                  const legacyItem = item as LegacyItem;
                  const legacyProps = props as LegacyProps;
                  return (
                    <ItemCard
                      key={`item-${idx}`}
                      item={legacyItem}
                      isSelected={selected.has(idx)}
                      isCurrent={idx === currentIndex}
                      isEnhanced={false}
                      onSelect={() => legacyProps.onPickScan(idx)}
                      scanColor={legacyProps.scanColor(idx)}
                      matchColor={legacyProps.matchColor(idx)}
                      detailsColor={legacyProps.detailsColor(idx)}
                      detailsEnabled={legacyProps.detailsEnabled(idx)}
                      onPickScan={() => legacyProps.onPickScan(idx)}
                      onPickMatch={() => legacyProps.onPickMatch(idx)}
                      onPickDetails={() => legacyProps.onPickDetails(idx)}
                      onQuickGenerate={legacyProps.onQuickGenerate
                        ? () => legacyProps.onQuickGenerate!(idx)
                        : undefined}
                      onRescan={legacyProps.onRescan
                        ? () => legacyProps.onRescan!(idx)
                        : undefined}
                      countLabel={legacyProps.countLabel}
                      secondaryText={legacyProps.getSecondaryText?.(idx)}
                      selectMode={selectMode}
                      onToggleSelect={() => toggleIndex(idx)}
                    />
                  );
                }
              })
            )}
          </ScrollView>

          {/* Footer - Batch Actions */}
          {enableMultiSelect && selectMode && (
            <View style={styles.footerBar}>
              <View style={styles.footerLeft}>
                <TouchableOpacity onPress={selected.size === items.length ? clearAll : selectAll}>
                  <Text style={styles.footerToggleText}>
                    {selected.size === items.length ? 'Clear all' : 'Select all'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.footerCount}>| Selected: {selected.size}</Text>
              </View>

              <View style={styles.footerActions}>
                {enhanced ? (
                  <>
                    {(props as EnhancedProps).onBatchRescan && (
                      <TouchableOpacity
                        disabled={selected.size === 0}
                        onPress={() => (props as EnhancedProps).onBatchRescan?.(Array.from(selected))}
                        style={[styles.footerBtn, selected.size === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="reload" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Rescan {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as EnhancedProps).onBatchGenerate && (
                      <TouchableOpacity
                        disabled={selected.size === 0}
                        onPress={() => (props as EnhancedProps).onBatchGenerate?.(Array.from(selected))}
                        style={[styles.footerBtn, selected.size === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="rocket-launch-outline" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Generate {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    {(props as LegacyProps).onBatchRescanSelected && (
                      <TouchableOpacity
                        disabled={selected.size === 0}
                        onPress={() => (props as LegacyProps).onBatchRescanSelected?.(Array.from(selected))}
                        style={[styles.footerBtn, selected.size === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="reload" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Rescan {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as LegacyProps).onBatchGenerateSelected && (
                      <TouchableOpacity
                        disabled={selected.size === 0}
                        onPress={() => (props as LegacyProps).onBatchGenerateSelected?.(Array.from(selected))}
                        style={[styles.footerBtn, selected.size === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="rocket-launch-outline" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Generate {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)'
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34, // Safe area
    minHeight: '50%',
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerBtn: {
    padding: 4,
    minWidth: 50,
  },
  headerBtnText: {
    color: '#000',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginLeft: 8,
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 15,
  },

  // Item card
  card: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  cardCurrent: {
    borderColor: ANORHA_GREEN,
    backgroundColor: 'rgba(147, 200, 34, 0.04)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    marginRight: 10,
  },
  cardThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 12,
  },
  cardThumbPlaceholder: {
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    color: '#000',
    fontWeight: '600',
    fontSize: 15,
    marginBottom: 2,
  },
  cardMeta: {
    color: '#6B7280',
    fontSize: 13,
  },
  cardSecondary: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },

  // Steps row
  stepsRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 6,
    flexWrap: 'wrap',
  },

  // Enhanced step pill
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FAFAFA',
    gap: 6,
  },
  stepPillActive: {
    borderColor: ANORHA_GREEN,
    backgroundColor: 'rgba(147, 200, 34, 0.08)',
  },
  stepPillDisabled: {
    opacity: 0.5,
  },
  stepPillContent: {
    flexDirection: 'column',
  },
  stepPillLabel: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '500',
  },
  stepPillLabelActive: {
    color: '#000',
  },
  stepPillLabelDisabled: {
    color: '#9CA3AF',
  },
  stepPillProgress: {
    color: '#6B7280',
    fontSize: 10,
    marginTop: 1,
  },
  pendingDot: {
    borderRadius: 10,
    backgroundColor: '#D1D5DB',
  },

  // Legacy step pill
  legacyPill: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legacyDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  legacyPillText: {
    color: '#000',
    fontSize: 13,
  },

  // Footer
  footerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FAFAFA',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerToggleText: {
    color: '#000',
    fontWeight: '600',
  },
  footerCount: {
    color: '#6B7280',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ANORHA_GREEN,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  footerBtnDisabled: {
    opacity: 0.5,
  },
  footerBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },

  // Search bar
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 8,
  },
  searchClear: {
    padding: 4,
  },

  // Queue summary
  queueSummary: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  queueText: {
    fontSize: 13,
    color: '#6B7280',
  },
  queueProcessing: {
    color: '#F59E0B',
    fontWeight: '500',
  },
  queuePending: {
    color: '#6B7280',
  },
  queueComplete: {
    color: '#10B981',
    fontWeight: '500',
  },
  queueFailed: {
    color: '#EF4444',
    fontWeight: '500',
  },

  // Filter tabs
  filterTabsScroll: {
    maxHeight: 44,
    marginBottom: 4,
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 4,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  filterTabActive: {
    backgroundColor: '#111827',
  },
  filterTabText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: '#fff',
  },
});
