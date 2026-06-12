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

import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
  /** Optional: when multiple flows exist, group items by this in the modal */
  flowType?: string;
  flowId?: string;
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
  onConfirmCandidate?: (index: number) => void;
  onDenyCandidate?: (index: number) => void;
  onSubmitRefineText?: (index: number, text: string) => void;
  onGenerateBestGuess?: (index: number) => void;
  onRetakePhoto?: (index: number) => void;
  /** Optional label for current job (e.g. "Match abc123…") so modal clearly refers to this flow */
  jobLabel?: string;
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
  onConfirmCandidate?: (index: number) => void;
  onDenyCandidate?: (index: number) => void;
  onSubmitRefineText?: (index: number, text: string) => void;
  onGenerateBestGuess?: (index: number) => void;
  onRetakePhoto?: (index: number) => void;
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
  /** Legacy mode: resolved generate status driving the single status/action button. */
  generateStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  /** Legacy mode: the item is paused on a decision (pick a match / add info). */
  needsInput?: boolean;
  onConfirmCandidate?: () => void;
  onDenyCandidate?: () => void;
  onSubmitRefineText?: (text: string) => void;
  onGenerateBestGuess?: () => void;
  onRetakePhoto?: () => void;
}> = (props) => {
  const {
    item, isSelected, isCurrent, isEnhanced, onSelect, selectMode, onToggleSelect
  } = props;
  const [refineText, setRefineText] = useState('');

  // Extract properties with proper type handling
  const itemAsLegacy = item as LegacyItem;
  const itemAsEnhanced = item as ItemJobState;

  const title = itemAsLegacy.title || `Item ${itemAsLegacy.index + 1}`;
  const thumb = itemAsLegacy.thumb || itemAsEnhanced.thumb;
  const matchesCount = 'matchesCount' in item
    ? itemAsLegacy.matchesCount
    : itemAsEnhanced.match?.matchesCount || 0;
  const timelineText = React.useMemo(() => {
    const toLabel = (status: StepStatus): string => {
      if (status === 'completed') return 'Ready';
      if (status === 'processing' || status === 'queued') return 'Working';
      if (status === 'failed') return 'Needs retry';
      if (status === 'skipped') return 'Skipped';
      return 'Pending';
    };

    if (isEnhanced && props.getStepStatus) {
      return `Scan ${toLabel(props.getStepStatus('scan'))} • Match ${toLabel(props.getStepStatus('match'))} • Generate ${toLabel(props.getStepStatus('generate'))} • Details ${toLabel(props.getStepStatus('details'))}`;
    }

    const matchDone = props.matchColor === ANORHA_GREEN || props.matchColor === '#10B981';
    const matchWorking = props.matchColor === '#FFD700' || props.matchColor === '#F59E0B';
    const detailsDone = props.detailsColor === ANORHA_GREEN || props.detailsColor === '#10B981';
    const detailsWorking = props.detailsColor === '#FFD700' || props.detailsColor === '#F59E0B';
    const detailsFailed = props.detailsColor === '#e11d48' || props.detailsColor === '#EF4444';

    const matchLabel = matchDone ? 'Ready' : (matchWorking ? 'Working' : 'Pending');
    const detailsLabel = detailsFailed ? 'Needs retry' : (detailsDone ? 'Ready' : (detailsWorking ? 'Working' : 'Pending'));
    return `Match ${matchLabel} • Details ${detailsLabel}`;
  }, [isEnhanced, props]);

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
          // Legacy mode — ONE status-driven action per row: a ready item says so and
          // opens its review; a stuck item says what it needs and opens the match
          // page (where refine/add-info lives). No more cryptic step pills.
          (() => {
            const st = props.generateStatus ?? 'pending';
            if (st === 'completed') {
              return (
                <TouchableOpacity style={[styles.statusActionBtn, styles.statusActionReady]} onPress={props.onPickDetails}>
                  <Icon name="check-circle" size={16} color="#3F6212" />
                  <Text style={[styles.statusActionText, { color: '#3F6212' }]}>Ready · Review listing</Text>
                  <Icon name="chevron-right" size={16} color="#3F6212" />
                </TouchableOpacity>
              );
            }
            if (st === 'processing') {
              return (
                <TouchableOpacity style={[styles.statusActionBtn, styles.statusActionWorking]} onPress={props.onPickDetails}>
                  <SpinningLoader size={14} color="#B45309" />
                  <Text style={[styles.statusActionText, { color: '#92400E' }]}>Generating · tap for progress</Text>
                </TouchableOpacity>
              );
            }
            if (st === 'failed') {
              return (
                <TouchableOpacity style={[styles.statusActionBtn, styles.statusActionFailed]} onPress={props.onQuickGenerate || props.onPickDetails}>
                  <Icon name="refresh" size={16} color="#B91C1C" />
                  <Text style={[styles.statusActionText, { color: '#B91C1C' }]}>Failed · Retry</Text>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity style={[styles.statusActionBtn, styles.statusActionNeeds]} onPress={props.onPickMatch}>
                <Icon name="alert-circle-outline" size={16} color="#9A3412" />
                <Text style={[styles.statusActionText, { color: '#9A3412' }]}>
                  {matchesCount > 0 || props.needsInput ? 'Needs you · Pick the match' : 'Needs info · Refine the match'}
                </Text>
                <Icon name="chevron-right" size={16} color="#9A3412" />
              </TouchableOpacity>
            );
          })()
        )}
      </View>
      <Text style={styles.timelineText} numberOfLines={1}>{timelineText}</Text>

      {!selectMode && (props.onConfirmCandidate || props.onDenyCandidate || props.onGenerateBestGuess || props.onRetakePhoto || props.onSubmitRefineText) && (
        <View style={styles.assistActionsWrap}>
          <View style={styles.assistActionsRow}>
            {props.onConfirmCandidate && (
              <TouchableOpacity style={styles.assistPrimaryBtn} onPress={props.onConfirmCandidate}>
                <Text style={styles.assistPrimaryBtnText}>Confirm</Text>
              </TouchableOpacity>
            )}
            {props.onDenyCandidate && (
              <TouchableOpacity style={styles.assistSecondaryBtn} onPress={props.onDenyCandidate}>
                <Text style={styles.assistSecondaryBtnText}>Deny</Text>
              </TouchableOpacity>
            )}
            {props.onGenerateBestGuess && (
              <TouchableOpacity style={styles.assistGhostBtn} onPress={props.onGenerateBestGuess}>
                <Text style={styles.assistGhostBtnText}>Best Guess</Text>
              </TouchableOpacity>
            )}
            {props.onRetakePhoto && (
              <TouchableOpacity style={styles.assistGhostBtn} onPress={props.onRetakePhoto}>
                <Text style={styles.assistGhostBtnText}>Retake</Text>
              </TouchableOpacity>
            )}
          </View>
          {props.onSubmitRefineText && (
            <View style={styles.assistRefineRow}>
              <TextInput
                value={refineText}
                onChangeText={setRefineText}
                style={styles.assistRefineInput}
                placeholder="Refine text..."
                placeholderTextColor="#94A3B8"
              />
              <TouchableOpacity
                style={[styles.assistRefineSubmit, refineText.trim().length === 0 && styles.assistRefineSubmitDisabled]}
                disabled={refineText.trim().length === 0}
                onPress={() => {
                  const value = refineText.trim();
                  if (!value) return;
                  props.onSubmitRefineText?.(value);
                  setRefineText('');
                }}
              >
                <Text style={styles.assistRefineSubmitText}>Use</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

// Main modal component
export default function ItemJobsModal(props: Props) {
  const { visible, onClose } = props;
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed' | 'needs_input'>('all');

  const enhanced = isEnhancedProps(props);
  const items = props.items;
  const currentIndex = props.currentIndex;

  const getGenerateStatus = useMemo(() => {
    return (item: ItemJobState | LegacyItem): 'pending' | 'processing' | 'completed' | 'failed' => {
      if (enhanced) {
        const genStatus = (item as ItemJobState).generate?.status;
        if (genStatus === 'completed') return 'completed';
        if (genStatus === 'failed') return 'failed';
        if (genStatus === 'processing' || genStatus === 'queued') return 'processing';
        return 'pending';
      }
      const legacyProps = props as LegacyProps;
      const detailsColor = legacyProps.detailsColor(item.index);
      if (detailsColor === ANORHA_GREEN) return 'completed';
      if (detailsColor === '#FFD700' || detailsColor === '#F59E0B') return 'processing';
      if (detailsColor === '#e11d48' || detailsColor === '#EF4444') return 'failed';
      return 'pending';
    };
  }, [enhanced, props]);
  const itemNeedsInput = useCallback((idx: number) => {
    const secondary = enhanced
      ? ((props as EnhancedProps).getSubstepText?.(idx, 'match') || '')
      : ((props as LegacyProps).getSecondaryText?.(idx) || '');
    return /need|review|input|assist|refine|await|decision|paused|stuck/i.test(String(secondary));
  }, [enhanced, props]);
  const awaitingDecisionIndices = useMemo(() => {
    return items
      .filter((item) => {
        const idx = item.index;
        const secondary = enhanced
          ? ((props as EnhancedProps).getSubstepText?.(idx, 'match') || '')
          : ((props as LegacyProps).getSecondaryText?.(idx) || '');
        return /await|decision|paused|stuck/i.test(String(secondary));
      })
      .map((item) => item.index);
  }, [items, enhanced, props]);

  // Calculate status counts for queue summary
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0, activeItems: [] as string[] };
    items.forEach(item => {
      const title = (item as LegacyItem).title || `Item ${item.index + 1}`;
      const genStatus = getGenerateStatus(item);
      if (genStatus === 'completed') counts.completed++;
      else if (genStatus === 'processing') {
        counts.processing++;
        if (counts.activeItems.length < 2) counts.activeItems.push(title);
      } else if (genStatus === 'failed') counts.failed++;
      else counts.pending++;
    });
    return counts;
  }, [items, getGenerateStatus]);
  const needsInputIndices = useMemo(() => {
    return items
      .filter((item) => itemNeedsInput(item.index))
      .map((item) => item.index);
  }, [items, itemNeedsInput]);
  const unresolvedIndices = useMemo(() => {
    return items
      .filter((item) => {
        const idx = item.index;
        const status = getGenerateStatus(item);
        return itemNeedsInput(idx) || status === 'pending' || status === 'failed';
      })
      .map((item) => item.index);
  }, [items, getGenerateStatus, itemNeedsInput]);
  const jumpToNextUnresolved = useCallback(() => {
    if (unresolvedIndices.length === 0) return;
    const ordered = [...unresolvedIndices].sort((a, b) => a - b);
    const next = ordered.find((idx) => idx > currentIndex) ?? ordered[0];
    if (enhanced) {
      (props as EnhancedProps).onItemSelect(next);
    } else {
      (props as LegacyProps).onPickMatch(next);
    }
    setStatusFilter('needs_input');
  }, [unresolvedIndices, currentIndex, enhanced, props]);

  // Legacy summary: only match + generate — "X matched • Y ready to review • Z generating"
  const stepSummaryLegacy = useMemo(() => {
    if (enhanced) return null;
    const legacyProps = props as LegacyProps;
    let matchDone = 0, genInProgress = 0, genDone = 0, genFailed = 0;
    const activeItems: string[] = [];
    items.forEach(item => {
      const idx = item.index;
      const title = (item as LegacyItem).title || `Item ${idx + 1}`;
      const matchGreen = legacyProps.matchColor(idx) === ANORHA_GREEN || legacyProps.matchColor(idx) === '#10B981';
      const detailsColor = legacyProps.detailsColor(idx);
      const detailsGreen = detailsColor === ANORHA_GREEN || detailsColor === '#10B981';
      const detailsYellow = detailsColor === '#FFD700' || detailsColor === '#F59E0B';
      const detailsRed = detailsColor === '#e11d48' || detailsColor === '#EF4444';
      if (matchGreen) matchDone++;
      if (detailsGreen) genDone++;
      else if (detailsRed) genFailed++;
      else if (detailsYellow) {
        genInProgress++;
        if (activeItems.length < 2) activeItems.push(title);
      }
    });
    return { matchDone, genInProgress, genDone, genFailed, activeItems };
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
        const genStatus = getGenerateStatus(item);
        const idx = item.index;
        if (statusFilter === 'pending') return genStatus === 'pending';
        if (statusFilter === 'processing') return genStatus === 'processing';
        if (statusFilter === 'completed') return genStatus === 'completed';
        if (statusFilter === 'failed') return genStatus === 'failed';
        if (statusFilter === 'needs_input') return itemNeedsInput(idx);
        return false;
      }) as typeof items;
    }

    return result;
  }, [items, searchQuery, statusFilter, getGenerateStatus, itemNeedsInput]);

  // Group by flowType when multiple flows exist (optional multi-flow support)
  const flowGroups = useMemo(() => {
    const withFlow = filteredItems as Array<{ index: number; flowType?: string; flowId?: string }>;
    const keys = [...new Set(withFlow.map(i => i.flowType ?? 'default'))];
    if (keys.length <= 1) return null;
    const groups: Record<string, Array<ItemJobState | LegacyItem>> = {};
    filteredItems.forEach(item => {
      const key = (item as Partial<LegacyItem>).flowType ?? 'default';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [filteredItems]);

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

  const getTopIssueText = useCallback((item: ItemJobState | LegacyItem): string => {
    const status = getGenerateStatus(item);
    if (status === 'failed') return 'Failed';
    if (status === 'processing') return 'Generating';
    if (status === 'completed') return 'Ready';
    return 'Needs review';
  }, [getGenerateStatus]);

  // Legacy mode: a card tap routes by status — done/working items open their
  // details (review or live progress), failed retries, everything else lands on
  // the match page where the user can decide or add info. Never the raw scan view.
  const legacyOpen = useCallback((idx: number, item: LegacyItem) => {
    const lp = props as LegacyProps;
    const status = getGenerateStatus(item);
    if ((status === 'completed' || status === 'processing') && lp.detailsEnabled(idx)) {
      lp.onPickDetails(idx);
      return;
    }
    if (status === 'failed') {
      (lp.onQuickGenerate ?? lp.onPickDetails)(idx);
      return;
    }
    lp.onPickMatch(idx);
  }, [props, getGenerateStatus]);

  const enableMultiSelect = enhanced
    ? props.enableMultiSelect
    : (props as LegacyProps).enableMultiSelect;

  const hasBatchOperations = enhanced
    ? !!(props.onBatchGenerate || props.onBatchRescan)
    : !!((props as LegacyProps).onBatchGenerateSelected || (props as LegacyProps).onBatchRescanSelected);

  const selectedItemsList = useMemo(
    () => items.filter(item => selected.has(item.index)),
    [items, selected]
  );
  const selectedReadyIndices = useMemo(
    () => selectedItemsList
      .filter(item => {
        const status = getGenerateStatus(item);
        return status === 'pending' || status === 'completed';
      })
      .map(item => item.index),
    [selectedItemsList, getGenerateStatus]
  );
  const selectedFailedIndices = useMemo(
    () => selectedItemsList
      .filter(item => getGenerateStatus(item) === 'failed')
      .map(item => item.index),
    [selectedItemsList, getGenerateStatus]
  );

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

            <View style={styles.headerTitleBlock}>
              <Text style={styles.headerTitle}>Current Jobs</Text>
              <Text style={styles.headerSubtitle}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
            </View>

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

          {/* Queue Summary - Legacy: matched + ready to review + generating; Enhanced: status counts */}
          {items.length > 0 && (
            <View style={styles.queueSummary}>
              <Text style={styles.queueText}>
                {stepSummaryLegacy ? (
                  <>
                    <Text style={{ fontWeight: '600' }}>{stepSummaryLegacy.matchDone}/{items.length} matched</Text>
                    {stepSummaryLegacy.genDone > 0 && (
                      <Text style={styles.queueReadyReview}> • {stepSummaryLegacy.genDone} Ready</Text>
                    )}
                    {stepSummaryLegacy.genFailed > 0 && (
                      <Text style={styles.queueFailed}> • {stepSummaryLegacy.genFailed} Failed</Text>
                    )}
                    {stepSummaryLegacy.genInProgress > 0 && (
                      <Text style={[styles.queueProcessing, { fontWeight: '600' }]}> • {stepSummaryLegacy.genInProgress} Generating</Text>
                    )}
                  </>
                ) : (
                  <>
                    {statusCounts.processing > 0 && (
                      <Text style={[styles.queueProcessing, { fontWeight: '600' }]}>{statusCounts.processing} Generating</Text>
                    )}
                    {statusCounts.processing > 0 && statusCounts.pending > 0 && ' • '}
                    {statusCounts.pending > 0 && (
                      <Text style={styles.queuePending}>{statusCounts.pending} Needs Review</Text>
                    )}
                    {(statusCounts.processing > 0 || statusCounts.pending > 0) && statusCounts.completed > 0 && ' • '}
                    {statusCounts.completed > 0 && (
                      <Text style={styles.queueComplete}>{statusCounts.completed} Ready</Text>
                    )}
                    {statusCounts.failed > 0 && ' • '}
                    {statusCounts.failed > 0 && (
                      <Text style={styles.queueFailed}>{statusCounts.failed} Failed</Text>
                    )}
                  </>
                )}
              </Text>

              {/* Active Items Progress UI */}
              {((stepSummaryLegacy?.genInProgress || 0) > 0 || statusCounts.processing > 0) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: '#f9fafb', padding: 10, borderRadius: 8 }}>
                  <SpinningLoader size={16} color="#F59E0B" />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={{ fontSize: 13, color: '#111827', fontWeight: '500' }} numberOfLines={1}>
                      {stepSummaryLegacy ? stepSummaryLegacy.activeItems.join(', ') : statusCounts.activeItems.join(', ')}
                      {(stepSummaryLegacy ? stepSummaryLegacy.genInProgress : statusCounts.processing) > 2 ? ` + ${(stepSummaryLegacy ? stepSummaryLegacy.genInProgress : statusCounts.processing) - 2} more` : ''}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Estimated time: ~{Math.ceil((stepSummaryLegacy ? stepSummaryLegacy.genInProgress : statusCounts.processing) * 10)}s
                    </Text>
                  </View>
                </View>
              )}

              {stepSummaryLegacy && hasBatchOperations && (stepSummaryLegacy.genInProgress === 0) && (
                <Text style={styles.queueHint}>Generate uses the platforms you selected on the match screen.</Text>
              )}
              {awaitingDecisionIndices.length > 0 && (
                <View style={styles.awaitingBanner}>
                  <Icon name="alert-circle-outline" size={15} color="#9A3412" />
                  <Text style={styles.awaitingBannerText}>
                    {awaitingDecisionIndices.length} item{awaitingDecisionIndices.length !== 1 ? 's are' : ' is'} awaiting decision. Other items keep processing.
                  </Text>
                </View>
              )}
              {unresolvedIndices.length > 0 && (
                <TouchableOpacity style={styles.nextUnresolvedBtn} onPress={jumpToNextUnresolved}>
                  <Icon name="arrow-right-circle-outline" size={16} color="#7C2D12" />
                  <Text style={styles.nextUnresolvedBtnText}>Next unresolved ({unresolvedIndices.length})</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Status Filter Tabs - Only show when 5+ items */}
          {items.length >= 5 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterTabsScroll}>
              <View style={styles.filterTabs}>
                {(['all', 'pending', 'processing', 'completed', 'failed', 'needs_input'] as const).map(status => {
                  const count = status === 'all'
                    ? items.length
                    : status === 'needs_input'
                      ? needsInputIndices.length
                      : statusCounts[status];
                  const isActive = statusFilter === status;
                  if (status !== 'all' && count === 0) return null;
                  const statusLabel =
                    status === 'all' ? 'Open' :
                      status === 'pending' ? 'Needs Review' :
                        status === 'processing' ? 'Generating' :
                          status === 'completed' ? 'Ready' :
                            status === 'needs_input' ? 'Needs Input' : 'Failed';
                  return (
                    <TouchableOpacity
                      key={status}
                      onPress={() => setStatusFilter(status)}
                      style={[styles.filterTab, isActive && styles.filterTabActive]}
                    >
                      <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
                        {statusLabel}
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
            ) : flowGroups ? (
              Object.entries(flowGroups).map(([flowKey, groupItems]) => (
                <View key={flowKey} style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginHorizontal: 16, marginBottom: 8, fontWeight: '500' }}>
                    {flowKey === 'default' ? 'Items' : flowKey}
                  </Text>
                  {groupItems.map((item) => {
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
                          secondaryText={getTopIssueText(enhancedItem)}
                          selectMode={selectMode}
                          onToggleSelect={() => toggleIndex(idx)}
                          onConfirmCandidate={enhanced ? () => (props as EnhancedProps).onConfirmCandidate?.(idx) : () => (props as LegacyProps).onConfirmCandidate?.(idx)}
                          onDenyCandidate={enhanced ? () => (props as EnhancedProps).onDenyCandidate?.(idx) : () => (props as LegacyProps).onDenyCandidate?.(idx)}
                          onGenerateBestGuess={enhanced ? () => (props as EnhancedProps).onGenerateBestGuess?.(idx) : () => (props as LegacyProps).onGenerateBestGuess?.(idx)}
                          onRetakePhoto={enhanced ? () => (props as EnhancedProps).onRetakePhoto?.(idx) : () => (props as LegacyProps).onRetakePhoto?.(idx)}
                          onSubmitRefineText={(text) => {
                            if (enhanced) (props as EnhancedProps).onSubmitRefineText?.(idx, text);
                            else (props as LegacyProps).onSubmitRefineText?.(idx, text);
                          }}
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
                          onSelect={() => legacyOpen(idx, legacyItem)}
                          generateStatus={getGenerateStatus(legacyItem)}
                          needsInput={itemNeedsInput(idx)}
                          scanColor={legacyProps.scanColor(idx)}
                          matchColor={legacyProps.matchColor(idx)}
                          detailsColor={legacyProps.detailsColor(idx)}
                          detailsEnabled={legacyProps.detailsEnabled(idx)}
                          onPickScan={() => legacyProps.onPickScan(idx)}
                          onPickMatch={() => legacyProps.onPickMatch(idx)}
                          onPickDetails={() => legacyProps.onPickDetails(idx)}
                          onQuickGenerate={legacyProps.onQuickGenerate ? () => legacyProps.onQuickGenerate!(idx) : undefined}
                          onRescan={legacyProps.onRescan ? () => legacyProps.onRescan!(idx) : undefined}
                          countLabel={legacyProps.countLabel}
                          secondaryText={legacyProps.getSecondaryText?.(idx) || getTopIssueText(legacyItem)}
                          selectMode={selectMode}
                          onToggleSelect={() => toggleIndex(idx)}
                        />
                      );
                    }
                  })}
                </View>
              ))
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
                      secondaryText={getTopIssueText(enhancedItem)}
                      selectMode={selectMode}
                      onToggleSelect={() => toggleIndex(idx)}
                      onConfirmCandidate={enhanced ? () => (props as EnhancedProps).onConfirmCandidate?.(idx) : () => (props as LegacyProps).onConfirmCandidate?.(idx)}
                      onDenyCandidate={enhanced ? () => (props as EnhancedProps).onDenyCandidate?.(idx) : () => (props as LegacyProps).onDenyCandidate?.(idx)}
                      onGenerateBestGuess={enhanced ? () => (props as EnhancedProps).onGenerateBestGuess?.(idx) : () => (props as LegacyProps).onGenerateBestGuess?.(idx)}
                      onRetakePhoto={enhanced ? () => (props as EnhancedProps).onRetakePhoto?.(idx) : () => (props as LegacyProps).onRetakePhoto?.(idx)}
                      onSubmitRefineText={(text) => {
                        if (enhanced) (props as EnhancedProps).onSubmitRefineText?.(idx, text);
                        else (props as LegacyProps).onSubmitRefineText?.(idx, text);
                      }}
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
                      onSelect={() => legacyOpen(idx, legacyItem)}
                      generateStatus={getGenerateStatus(legacyItem)}
                      needsInput={itemNeedsInput(idx)}
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
                      secondaryText={legacyProps.getSecondaryText?.(idx) || getTopIssueText(legacyItem)}
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
                          Rescan selected {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as EnhancedProps).onBatchGenerate && (
                      <TouchableOpacity
                        disabled={selectedReadyIndices.length === 0}
                        onPress={() => (props as EnhancedProps).onBatchGenerate?.(selectedReadyIndices)}
                        style={[styles.footerBtn, selectedReadyIndices.length === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="rocket-launch-outline" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Generate ready {selectedReadyIndices.length > 0 ? `(${selectedReadyIndices.length})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as EnhancedProps).onBatchGenerate && (
                      <TouchableOpacity
                        disabled={selectedFailedIndices.length === 0}
                        onPress={() => (props as EnhancedProps).onBatchGenerate?.(selectedFailedIndices)}
                        style={[styles.footerBtn, selectedFailedIndices.length === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="refresh-circle" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Retry failed {selectedFailedIndices.length > 0 ? `(${selectedFailedIndices.length})` : ''}
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
                          Rescan selected {selected.size > 0 ? `(${selected.size})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as LegacyProps).onBatchGenerateSelected && (
                      <TouchableOpacity
                        disabled={selectedReadyIndices.length === 0}
                        onPress={() => (props as LegacyProps).onBatchGenerateSelected?.(selectedReadyIndices)}
                        style={[styles.footerBtn, selectedReadyIndices.length === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="rocket-launch-outline" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Generate ready {selectedReadyIndices.length > 0 ? `(${selectedReadyIndices.length})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(props as LegacyProps).onBatchGenerateSelected && (
                      <TouchableOpacity
                        disabled={selectedFailedIndices.length === 0}
                        onPress={() => (props as LegacyProps).onBatchGenerateSelected?.(selectedFailedIndices)}
                        style={[styles.footerBtn, selectedFailedIndices.length === 0 && styles.footerBtnDisabled]}
                      >
                        <Icon name="refresh-circle" size={16} color="#fff" />
                        <Text style={styles.footerBtnText}>
                          Retry failed {selectedFailedIndices.length > 0 ? `(${selectedFailedIndices.length})` : ''}
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
  headerTitleBlock: {
    flex: 1,
    marginLeft: 8,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
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
  timelineText: {
    marginTop: 6,
    color: '#6B7280',
    fontSize: 11,
  },
  assistActionsWrap: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    paddingTop: 8,
    gap: 8,
  },
  assistActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  assistPrimaryBtn: {
    backgroundColor: '#111827',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assistPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  assistSecondaryBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assistSecondaryBtnText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  assistGhostBtn: {
    backgroundColor: '#ECFCCB',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#BEF264',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assistGhostBtnText: {
    color: '#365314',
    fontSize: 11,
    fontWeight: '700',
  },
  assistRefineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assistRefineInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 7,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  assistRefineSubmit: {
    backgroundColor: '#111827',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  assistRefineSubmitDisabled: {
    opacity: 0.45,
  },
  assistRefineSubmitText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  nextUnresolvedBtn: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDBA74',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  nextUnresolvedBtnText: {
    color: '#9A3412',
    fontSize: 12,
    fontWeight: '700',
  },
  awaitingBanner: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDBA74',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  awaitingBannerText: {
    color: '#9A3412',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },

  // Steps row
  stepsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
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

  // Single status/action button on legacy rows (status + where it takes you)
  statusActionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusActionReady: { borderColor: '#BEF264', backgroundColor: '#F4FCE3' },
  statusActionWorking: { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' },
  statusActionFailed: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  statusActionNeeds: { borderColor: '#FDBA74', backgroundColor: '#FFF7ED' },
  statusActionText: { flex: 1, fontSize: 13, fontWeight: '700' },

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
  queueHint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
  },
  queueProcessing: {
    color: '#F59E0B',
    fontWeight: '500',
  },
  queuePending: {
    color: '#6B7280',
  },
  queueReadyReview: {
    color: '#374151',
    fontWeight: '500',
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
