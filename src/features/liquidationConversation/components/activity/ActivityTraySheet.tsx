// ActivityTraySheet — the review tray. Built on the FieldSheet shell idiom
// (reanimated grow-up spring, scrim fade, grabber pan-to-resize / fling-dismiss)
// PLUS the capability the codebase lacked: an internal page stack so a card can
// drill into one detail (root -> one sub-page, depth capped at 2). Two axes of
// navigation: VERTICAL is the sheet (drag / fling / scrim-tap dismiss), HORIZONTAL
// is the stack (tap a "›" row pushes, the header back-chevron pops).
//
// One instance is mounted by ConversationList for the whole feed.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  FadeIn,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { CHAT_COLORS, CHAT_FONT } from '../../../../design/chatGlass';
import type { ActivityPayload, CampaignItem, ConversationToolStep, PlanPayload, PlanStep, ReportDocument, ValueChange } from '../../types';
import ValueDiff from './ValueDiff';
import { activityGlyph, humanizeCadence, humanizeChannel, toolDoneLabel, toolStepIcon } from './humanizers';
import {
  copyMarkdown,
  documentHasTabularData,
  documentToMarkdown,
  organizeReportDocument,
  reportSectionHeading,
  saveCsvFile,
  savePdfFile,
  shareMarkdown,
} from './documentExport';
import { HorizontalFadeScroll } from '../HorizontalFadeScroll';
import { compactDisplayText, sanitizeDisplayText } from '../../displayText';
import { campaignItemPrice, getPlanDisplayTitle, matchPlanItem } from '../../planPresentation';

const SCREEN_H = Dimensions.get('window').height;
const DEFAULT_H = Math.round(SCREEN_H * 0.62);
const EXPANDED_H = Math.round(SCREEN_H * 0.92);

type TrayPage =
  | { kind: 'root'; title: string }
  | { kind: 'change-detail'; title: string; change: ValueChange }
  | { kind: 'step-detail'; title: string; step: ConversationToolStep }
  | { kind: 'evidence'; title: string };

export interface ActivityTraySheetProps {
  visible: boolean;
  payload: ActivityPayload | null;
  planItems?: CampaignItem[];
  onClose: () => void;
  onOpenItem?: (productId: string) => void;
  onUndo?: (payload: ActivityPayload, change?: ValueChange) => Promise<void> | void;
  onRoutineAction?: (id: string, action: 'pause' | 'resume' | 'edit' | 'delete' | 'cancel') => void;
  /** Send the seller's revision request for a report back to Sprout (revise_report). */
  onReviseDocument?: (documentId: string, title: string, note: string) => void;
  /** Approve / Revise / Follow-up a proposed plan (hits the pending-action endpoint). */
  onApprovePlan?: (planId: string, action: 'approve' | 'revise' | 'follow_up') => void;
  /** Close the tray and move this plan into the chat composer for revision. */
  onEditPlan?: (plan: PlanPayload) => void;
  submittingPlanId?: string | null;
  /** One report-specific next step. It renders after the evidence, never on Home. */
  documentAction?: { label: string; description?: string; onPress: () => void };
}

export default function ActivityTraySheet({
  visible,
  payload,
  planItems,
  onClose,
  onOpenItem,
  onUndo,
  onRoutineAction,
  onReviseDocument,
  onApprovePlan,
  onEditPlan,
  submittingPlanId,
  documentAction,
}: ActivityTraySheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [stack, setStack] = useState<TrayPage[]>([]);
  const [navForward, setNavForward] = useState(true);
  const [confirmUndo, setConfirmUndo] = useState(false);
  // Document-viewer state, lifted here so the header's "···" menu can drive the
  // Preview/Edit toggle and the Copy / Save / Share actions on the live draft.
  const [menuOpen, setMenuOpen] = useState(false);
  const [docMode, setDocMode] = useState<'preview' | 'code'>('preview');
  const [docDraft, setDocDraft] = useState('');
  const height = useSharedValue(0);

  const rootTitle = sanitizeDisplayText(payload?.title || 'Details');

  // Mount on open; collapse then unmount on close.
  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else if (mounted) {
      height.value = withTiming(0, { duration: 200 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Grow up + reset the stack whenever a fresh payload opens the tray. A document opens
  // near-full-height and reads like a document viewer, not a small tray.
  useEffect(() => {
    if (mounted) {
      setStack([{ kind: 'root', title: rootTitle }]);
      setConfirmUndo(false);
      setNavForward(true);
      setMenuOpen(false);
      const doc = payload && payload.kind === 'document' ? payload.document : null;
      const isLongForm = payload?.kind === 'document' || payload?.kind === 'plan';
      setDocMode('preview');
      setDocDraft(doc ? documentToMarkdown(doc) : '');
      height.value = withSpring(isLongForm ? EXPANDED_H : DEFAULT_H, { damping: 24, stiffness: 240, mass: 0.7 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, payload?.id]);

  // Default to a root page so the FIRST committed render (before the seed effect
  // below has run) never derefs an empty stack — that window would otherwise
  // crash PageBody/Footer with `undefined.kind` on every open.
  const top: TrayPage = stack[stack.length - 1] ?? { kind: 'root', title: rootTitle };
  const depth = Math.max(stack.length, 1);

  const push = (page: TrayPage) => {
    Haptics.selectionAsync().catch(() => undefined);
    setNavForward(true);
    setConfirmUndo(false);
    setStack((s) => (s.length >= 2 ? s : [...s, page]));
  };
  const pop = () => {
    Haptics.selectionAsync().catch(() => undefined);
    setNavForward(false);
    setConfirmUndo(false);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };
  const requestClose = () => {
    if (depth > 1) pop();
    else onClose();
  };

  const pan = Gesture.Pan()
    .onChange((e) => {
      'worklet';
      const next = height.value - e.changeY;
      height.value = Math.max(0, Math.min(EXPANDED_H, next));
    })
    .onEnd((e) => {
      'worklet';
      const h = height.value;
      const closeThreshold = DEFAULT_H * 0.55;
      const midpoint = (DEFAULT_H + EXPANDED_H) / 2;
      if (h < closeThreshold || e.velocityY > 900) {
        height.value = withTiming(0, { duration: 190 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else if (h > midpoint || e.velocityY < -700) {
        height.value = withSpring(EXPANDED_H, { damping: 26, stiffness: 240 });
      } else {
        height.value = withSpring(DEFAULT_H, { damping: 26, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(height.value, [0, DEFAULT_H], [0, 0.45], Extrapolation.CLAMP),
  }));

  const openItem = (productId?: string | null) => {
    if (!productId) return;
    onClose();
    onOpenItem?.(productId);
  };

  if (!mounted || !payload) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, backdropStyle]} pointerEvents="none" />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

          <Animated.View style={[styles.sheet, sheetStyle]}>
            <GestureDetector gesture={pan}>
              <View style={styles.grabberZone}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>

            {/* A document gets a document-viewer header — close · centered title · "···"
                menu (Preview / Edit · Copy / Save / Share). Everything else keeps the
                morphing tray header: depth 1 = icon tile + title; depth 2 = back chevron. */}
            {payload.kind === 'document' && depth === 1 ? (
              <View style={styles.docHeader}>
                <TouchableOpacity style={styles.circleBtn} onPress={onClose} hitSlop={HIT} accessibilityLabel="Close">
                  <Icon name="close" size={21} color={CHAT_COLORS.dim} />
                </TouchableOpacity>
                <Text style={styles.docHeaderTitle} numberOfLines={1}>
                  Report: {sanitizeDisplayText(payload.document.title || payload.title)}
                </Text>
                <TouchableOpacity style={styles.circleBtn} onPress={() => { Haptics.selectionAsync().catch(() => undefined); setMenuOpen(o => !o); }} hitSlop={HIT} accessibilityLabel="Document options">
                  <Icon name="dots-horizontal" size={20} color={CHAT_COLORS.dim} />
                </TouchableOpacity>
              </View>
            ) : payload.kind === 'plan' && depth === 1 ? (
              <View style={styles.planHeader}>
                <Text style={styles.planHeaderTitle} numberOfLines={1}>
                  Plan: {getPlanDisplayTitle(payload.plan)}
                </Text>
                <View style={styles.planHeaderActions}>
                  {onEditPlan ? (
                    <Pressable
                      style={styles.circleBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Edit plan in chat"
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => undefined);
                        onClose();
                        setTimeout(() => onEditPlan(payload.plan), 220);
                      }}
                    >
                      <Icon name="pencil-outline" size={20} color={CHAT_COLORS.inkSoft} />
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.circleBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close plan">
                    <Icon name="close" size={21} color={CHAT_COLORS.dim} />
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  {depth > 1 ? (
                    <TouchableOpacity style={styles.circleBtn} onPress={pop} hitSlop={HIT}>
                      <Icon name="chevron-left" size={20} color={CHAT_COLORS.dim} />
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.tile, payload.status === 'failed' && styles.tileFail, payload.status === 'syncing' && styles.tileSync]}>
                      <Icon
                        name={activityGlyph(payload)}
                        size={17}
                        color={payload.status === 'failed' ? CHAT_COLORS.error : payload.status === 'syncing' ? CHAT_COLORS.amber : CHAT_COLORS.brandDeep}
                      />
                    </View>
                  )}
                  <Animated.Text key={top?.title} entering={FadeIn.duration(160)} style={styles.headerTitle} numberOfLines={1}>
                    {top?.title}
                  </Animated.Text>
                </View>
                <TouchableOpacity style={styles.circleBtn} onPress={onClose} hitSlop={HIT}>
                  <Icon name="close" size={21} color={CHAT_COLORS.dim} />
                </TouchableOpacity>
              </View>
            )}

            {/* The document "···" dropdown. Scrim closes it on outside tap. */}
            {payload.kind === 'document' && menuOpen ? (
              <>
                <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)} />
                <View style={styles.menu}>
                  <DocMenuItem icon="eye-outline" label="Preview" active={docMode === 'preview'} onPress={() => { setDocMode('preview'); setMenuOpen(false); }} />
                  <DocMenuItem icon="text-box-edit-outline" label="Edit text" active={docMode === 'code'} onPress={() => { setDocMode('code'); setMenuOpen(false); }} />
                  <View style={styles.menuDivider} />
                  <DocMenuItem icon="content-copy" label="Copy" onPress={() => { setMenuOpen(false); Haptics.selectionAsync().catch(() => undefined); void copyMarkdown(docDraft); }} />
                  <DocMenuItem icon="file-pdf-box" label="Save as PDF" onPress={() => { setMenuOpen(false); void savePdfFile(payload.document.title, docDraft); }} />
                  {documentHasTabularData(payload.document) ? (
                    <DocMenuItem icon="table-arrow-down" label="Export CSV" onPress={() => { setMenuOpen(false); void saveCsvFile(payload.document.title, payload.document); }} />
                  ) : null}
                  <DocMenuItem icon="share-variant" label="Share" onPress={() => { setMenuOpen(false); void shareMarkdown(payload.document.title, docDraft); }} />
                </View>
              </>
            ) : null}

            {/* Page body — slides horizontally on push/pop. */}
            <Animated.View
              key={depth}
              entering={navForward ? SlideInRight.duration(220) : SlideInLeft.duration(220)}
              exiting={navForward ? SlideOutLeft.duration(200) : SlideOutRight.duration(200)}
              style={styles.flex}
            >
              <ScrollView
                style={styles.flex}
                contentContainerStyle={styles.content}
                contentInsetAdjustmentBehavior="automatic"
                showsVerticalScrollIndicator={false}
              >
                <PageBody
                  page={top}
                  payload={payload}
                  planItems={planItems}
                  onPushChange={(c) => push({ kind: 'change-detail', title: c.itemName || c.label, change: c })}
                  onPushStep={(step) => push({ kind: 'step-detail', title: toolDoneLabel(step.tool, step.label), step })}
                  onPushEvidence={() => push({ kind: 'evidence', title: "What it's based on" })}
                  onOpenItem={openItem}
                  onRevise={onReviseDocument}
                  onRequestClose={onClose}
                  docMode={docMode}
                  docDraft={docDraft}
                  onChangeDocDraft={setDocDraft}
                  documentAction={documentAction ? {
                    ...documentAction,
                    onPress: () => {
                      onClose();
                      documentAction.onPress();
                    },
                  } : undefined}
                />
              </ScrollView>
            </Animated.View>

            <Footer
              page={top}
              payload={payload}
              insetBottom={Math.max(insets.bottom, 16)}
              confirmUndo={confirmUndo}
              onApprovePlan={(action) => {
                if (submittingPlanId) return;
                if (payload.kind === 'plan' && payload.plan.pendingActionId) {
                  onApprovePlan?.(payload.plan.pendingActionId, action);
                }
                onClose();
              }}
              planSubmitting={
                payload.kind === 'plan' &&
                !!payload.plan.pendingActionId &&
                submittingPlanId === payload.plan.pendingActionId
              }
              onAskUndo={() => setConfirmUndo(true)}
              onCancelUndo={() => setConfirmUndo(false)}
              onConfirmUndo={async (change) => {
                setConfirmUndo(false);
                await onUndo?.(payload, change);
                onClose();
              }}
              onOpenItem={openItem}
              onRoutineAction={(action) => {
                onRoutineAction?.(payload.id, action);
                onClose();
              }}
            />
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ── Page bodies ─────────────────────────────────────────────────────────

function PageBody({
  page,
  payload,
  planItems,
  onPushChange,
  onPushStep,
  onPushEvidence,
  onOpenItem,
  onRevise,
  onRequestClose,
  docMode,
  docDraft,
  onChangeDocDraft,
  documentAction,
}: {
  page: TrayPage;
  payload: ActivityPayload;
  planItems?: CampaignItem[];
  onPushChange: (c: ValueChange) => void;
  onPushStep: (step: ConversationToolStep) => void;
  onPushEvidence: () => void;
  onOpenItem: (productId?: string | null) => void;
  onRevise?: (documentId: string, title: string, note: string) => void;
  onRequestClose?: () => void;
  docMode: 'preview' | 'code';
  docDraft: string;
  onChangeDocDraft: (v: string) => void;
  documentAction?: { label: string; description?: string; onPress: () => void };
}) {
  if (page.kind === 'evidence') {
    const evidence = 'evidence' in payload ? payload.evidence : undefined;
    if (!evidence) return <EmptyNote text="Nothing to show here." />;
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.evidenceHeadline}>{evidence.headline}</Text>
        {evidence.items.map((it, i) => (
          <View key={i} style={styles.evidenceRow}>
            {it.imageUrl ? <Image source={{ uri: it.imageUrl }} style={styles.evidenceThumb} /> : null}
            <View style={styles.flex}>
              <Text style={styles.evidenceLabel} numberOfLines={2}>{it.label}</Text>
              {it.sub ? <Text style={styles.evidenceSub} numberOfLines={1}>{it.sub}</Text> : null}
            </View>
            {it.value ? <Text style={styles.evidenceValue}>{it.value}</Text> : null}
          </View>
        ))}
      </View>
    );
  }

  if (page.kind === 'change-detail') {
    return <ChangeDetailBody change={page.change} payload={payload} onOpenItem={onOpenItem} onPushEvidence={undefined} />;
  }

  if (page.kind === 'step-detail') {
    const step = page.step;
    const stepChanges = step.changes ?? [];
    const detail = step.resultDetail;
    const failed = step.status === 'failed';
    const hasBody = !!(
      step.resultSummary ||
      step.reason ||
      stepChanges.length ||
      step.evidence ||
      (detail && ((detail.lines && detail.lines.length) || (detail.items && detail.items.length)))
    );
    return (
      <View style={{ gap: 14 }}>
        <View style={styles.outcomeRow}>
          <View style={[styles.outcomePill, failed && styles.outcomePillFail]}>
            <Icon name={failed ? 'close-circle-outline' : 'check-circle-outline'} size={14} color={failed ? CHAT_COLORS.error : CHAT_COLORS.brandDeep} />
            <Text style={[styles.outcomeText, failed && { color: CHAT_COLORS.errorDeep }]}>{failed ? "Couldn't finish" : 'Done'}</Text>
          </View>
          {typeof step.durationMs === 'number' && step.durationMs > 0 ? (
            <Text style={styles.outcomeMeta}>{(step.durationMs / 1000).toFixed(1)}s</Text>
          ) : null}
        </View>

        {step.resultSummary ? <Text style={styles.stepDetailSummary}>{step.resultSummary}</Text> : null}
        {step.reason ? <ReasonBanner text={step.reason} /> : null}

        {detail?.lines?.length ? (
          <View style={{ gap: 6 }}>
            {detail.lines.map((ln, i) => (
              <View key={i} style={styles.resultLineRow}>
                <View style={styles.resultDot} />
                <Text style={styles.resultLine}>{ln}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {stepChanges.length ? (
          <View style={{ gap: 10 }}>
            {stepChanges.map((c, i) => (
              <View key={`${c.field}-${i}`} style={styles.detailBlock}>
                {stepChanges.length > 1 ? <Text style={styles.heroLabel}>{c.itemName || c.label}</Text> : null}
                <ValueDiff from={c.from} to={c.to} unit={c.unit} kind={c.kind} direction={c.direction} variant="hero" />
              </View>
            ))}
          </View>
        ) : null}

        {detail?.items?.length ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>RESULTS</Text>
            {detail.items.map((it, i) => (
              <View key={i} style={styles.resultItemRow}>
                <View style={styles.flex}>
                  <Text style={styles.resultItemLabel} numberOfLines={1}>{it.label}</Text>
                  {it.sub ? <Text style={styles.resultItemSub} numberOfLines={1}>{it.sub}</Text> : null}
                </View>
                {it.value ? <Text style={styles.resultItemValue}>{it.value}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {step.evidence ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>BASED ON</Text>
            <Text style={styles.evidenceHeadline}>{step.evidence.headline}</Text>
            {step.evidence.items.map((it, i) => (
              <View key={i} style={styles.evidenceRow}>
                {it.imageUrl ? <Image source={{ uri: it.imageUrl }} style={styles.evidenceThumb} /> : null}
                <View style={styles.flex}>
                  <Text style={styles.evidenceLabel} numberOfLines={2}>{it.label}</Text>
                  {it.sub ? <Text style={styles.evidenceSub} numberOfLines={1}>{it.sub}</Text> : null}
                </View>
                {it.value ? <Text style={styles.evidenceValue}>{it.value}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {!hasBody ? <EmptyNote text="No extra detail was recorded for this step." /> : null}
      </View>
    );
  }

  // root
  if (payload.kind === 'plan') {
    return <PlanPage plan={payload.plan} items={planItems ?? []} onOpenItem={onOpenItem} />;
  }

  if (payload.kind === 'document') {
    return (
      <DocumentPage
        document={payload.document}
        mode={docMode}
        draft={docDraft}
        onChangeDraft={onChangeDocDraft}
        onRevise={onRevise}
        onRequestClose={onRequestClose}
        documentAction={documentAction}
      />
    );
  }
  if (payload.kind === 'value-change') {
    const changes = payload.changes ?? [];
    if (changes.length <= 1) {
      return (
        <ChangeDetailBody
          change={changes[0]}
          payload={payload}
          onOpenItem={onOpenItem}
          onPushEvidence={payload.evidence ? onPushEvidence : undefined}
        />
      );
    }
    return (
      <View style={{ gap: 12 }}>
        {payload.reason ? <ReasonBanner text={payload.reason} /> : null}
        {changes.map((c, i) => (
          <TouchableOpacity key={`${c.field}-${i}`} style={styles.listRow} activeOpacity={0.7} onPress={() => onPushChange(c)}>
            {c.itemImageUrl ? (
              <Image source={{ uri: c.itemImageUrl }} style={styles.listThumb} />
            ) : (
              <View style={[styles.listThumb, styles.listThumbFallback]}>
                <Icon name="package-variant" size={18} color={CHAT_COLORS.brandDeep} />
              </View>
            )}
            <View style={styles.flex}>
              <Text style={styles.listName} numberOfLines={1}>{c.itemName || c.label}</Text>
              <View style={{ marginTop: 3 }}>
                <ValueDiff from={c.from} to={c.to} unit={c.unit} kind={c.kind} direction={c.direction} variant="inline" />
              </View>
            </View>
            <Icon name="chevron-right" size={18} color={CHAT_COLORS.faint} />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  if (payload.kind === 'publish') {
    const changes = payload.changes ?? [];
    return (
      <View style={{ gap: 12 }}>
        {changes.map((c, i) => (
          <View key={i} style={styles.detailBlock}>
            <ValueDiff from={c.from} to={c.to} unit={c.unit} kind={c.kind ?? 'status'} direction={c.direction} variant="hero" />
          </View>
        ))}
        {payload.channels?.length ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>CHANNELS</Text>
            {payload.channels.map((ch) => (
              <View key={ch} style={styles.channelRow}>
                <Icon name="storefront-outline" size={16} color={CHAT_COLORS.dim} />
                <Text style={styles.channelName}>{humanizeChannel(ch)}</Text>
                <Icon name="check-circle" size={16} color={CHAT_COLORS.brand} style={{ marginLeft: 'auto' }} />
              </View>
            ))}
          </View>
        ) : null}
        {payload.itemRef ? <ItemIdentity itemRef={payload.itemRef} /> : null}
      </View>
    );
  }

  if (payload.kind === 'routine') {
    const r = payload.routine;
    return (
      <View style={{ gap: 14 }}>
        <DetailRow icon="calendar-clock" label="Runs" value={humanizeCadence(r.cadence)} />
        {r.watchLabel ? <DetailRow icon="eye-outline" label="Watches" value={r.watchLabel} /> : null}
        {r.scopeLabel ? <DetailRow icon="layers-outline" label="Scope" value={r.scopeLabel} /> : null}
        {r.lastRunOutcome ? <DetailRow icon="history" label="Last check" value={r.lastRunOutcome} /> : null}
        <View style={[styles.statusNote, r.paused && styles.statusNotePaused]}>
          <Icon name={r.paused ? 'pause-circle-outline' : 'check-circle-outline'} size={16} color={r.paused ? CHAT_COLORS.dim : CHAT_COLORS.brandDeep} />
          <Text style={[styles.statusNoteText, r.paused && { color: CHAT_COLORS.dim }]}>
            {r.paused ? 'Paused, not running right now' : 'On, running on schedule'}
          </Text>
        </View>
      </View>
    );
  }

  if (payload.kind === 'reminder') {
    return (
      <View style={{ gap: 14 }}>
        <DetailRow icon="clock-outline" label="When" value={payload.whenAtLabel} />
        <DetailRow icon="text" label="Reminder" value={payload.what} />
      </View>
    );
  }

  if (payload.kind === 'tool-run') {
    const steps = payload.steps ?? [];
    return (
      <View style={{ gap: 12 }}>
        {payload.reasoning && payload.reasoning.trim() ? (
          <View style={styles.reasoningBlock}>
            <View style={styles.reasoningHead}>
              <Icon name="lightbulb-on-outline" size={14} color={CHAT_COLORS.brandDeep} />
              <Text style={styles.reasoningHeadText}>Thinking</Text>
            </View>
            <Text style={styles.reasoningBody}>{payload.reasoning.trim()}</Text>
          </View>
        ) : null}
        {steps.map((step, i) => (
          // Every step opens its own detail page — tap to see what it returned.
          <TouchableOpacity
            key={`${step.tool}-${i}`}
            style={styles.stepRow}
            activeOpacity={0.7}
            onPress={() => onPushStep(step)}
          >
            <View style={[styles.stepChip, step.status === 'failed' && styles.stepChipFail]}>
              <Icon name={toolStepIcon(step.tool)} size={14} color={step.status === 'failed' ? CHAT_COLORS.error : CHAT_COLORS.brandDeep} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.stepLabel} numberOfLines={1}>{toolDoneLabel(step.tool, step.label)}</Text>
              {step.resultSummary ? <Text style={styles.stepResult} numberOfLines={2}>{step.resultSummary}</Text> : null}
            </View>
            {step.status === 'failed' ? <Text style={styles.stepFail}>failed</Text> : null}
            {typeof step.durationMs === 'number' && step.durationMs > 0 ? (
              <Text style={styles.stepMeta}>{(step.durationMs / 1000).toFixed(1)}s</Text>
            ) : null}
            <Icon name="chevron-right" size={16} color={CHAT_COLORS.faint} />
          </TouchableOpacity>
        ))}
        {!steps.length ? <EmptyNote text="Nothing to show here." /> : null}
      </View>
    );
  }

  return <EmptyNote text="Nothing to show here." />;
}

function ChangeDetailBody({
  change,
  payload,
  onOpenItem,
  onPushEvidence,
}: {
  change?: ValueChange;
  payload: ActivityPayload;
  onOpenItem: (productId?: string | null) => void;
  onPushEvidence?: () => void;
}) {
  if (!change) return <EmptyNote text="Nothing changed." />;
  const reason = payload.kind === 'value-change' ? payload.reason : undefined;
  const itemRef = payload.kind === 'value-change' || payload.kind === 'publish' ? payload.itemRef : undefined;
  const productId = change.productId || itemRef?.productId;

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.heroBlock}>
        <Text style={styles.heroLabel}>{change.label}</Text>
        <ValueDiff from={change.from} to={change.to} unit={change.unit} kind={change.kind} direction={change.direction} variant="hero" />
      </View>

      {(change.itemName || itemRef?.name) ? (
        <ItemIdentity
          itemRef={{
            productId: productId || '',
            name: change.itemName || itemRef?.name,
            imageUrl: change.itemImageUrl || itemRef?.imageUrl,
            listingCount: itemRef?.listingCount,
          }}
        />
      ) : null}

      {reason ? <ReasonBanner text={reason} /> : null}

      {onPushEvidence ? (
        <TouchableOpacity style={styles.drillRow} activeOpacity={0.7} onPress={onPushEvidence}>
          <Icon name="chart-line" size={16} color={CHAT_COLORS.dim} />
          <Text style={styles.drillText}>See what it&apos;s based on</Text>
          <Icon name="chevron-right" size={18} color={CHAT_COLORS.faint} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Plan page: an approval report, with structured evidence instead of a step list.

const PRICE_ROW = /(?:^|,\s*)([^,]+?)\s*(?:→|->)\s*(\$[\d,.]+)(?:\s*\(([^)]*)\))?(?=,\s*[^,]+?\s*(?:→|->)|[.]?$)/g;
const ITEM_AT_PRICE = /^(.+?)\s+(?:at|to)\s+(\$\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const BEFORE_PRICE = /\b(?:was|from|currently(?:\s+at)?|already\s+at)\s+(\$\d+(?:,\d{3})*(?:\.\d{1,2})?)/i;
const APPROACH = /\b(conservative|balanced|aggressive)(?:\s+sell-off)?\b/i;

function pricingRowsFromPlanDetail(detail: string): PlanPriceChange[] {
  const clean = sanitizeDisplayText(detail);
  return [...clean.matchAll(PRICE_ROW)].map((match) => ({
    name: sanitizeDisplayText(match[1]),
    after: sanitizeDisplayText(match[2]),
    approach: sanitizeDisplayText(match[3] || 'Market-based'),
  }));
}

type PlanPriceChange = {
  name: string;
  before?: string;
  after: string;
  approach: string;
};

type PlanContent = {
  prices: PlanPriceChange[];
  supporting: PlanStep[];
};

function priceChangeFromPlanStep(title: string, detail: string): PlanPriceChange | null {
  const cleanTitle = sanitizeDisplayText(title);
  const cleanDetail = sanitizeDisplayText(detail);
  const itemMatch = cleanDetail.match(ITEM_AT_PRICE);
  if (!itemMatch) return null;

  const after = itemMatch[2];
  const beforeMatch = cleanDetail.match(BEFORE_PRICE);
  const before = beforeMatch?.[1] || (/^keep\b/i.test(cleanTitle) ? after : 'Not shown');

  const approach = cleanDetail.match(APPROACH)?.[1];
  return {
    name: sanitizeDisplayText(itemMatch[1]),
    before,
    after,
    approach: approach ? `${approach[0].toUpperCase()}${approach.slice(1).toLowerCase()}` : 'Set price',
  };
}

function planContent(plan: PlanPayload): PlanContent {
  const prices: PlanPriceChange[] = [];
  const supporting: PlanStep[] = [];

  for (const step of plan.steps ?? []) {
    const heading = sanitizeDisplayText(step.title);
    const detail = sanitizeDisplayText(step.detail);
    const priceChange = priceChangeFromPlanStep(heading, detail);
    if (priceChange) {
      prices.push(priceChange);
      continue;
    }

    const priceRows = /price|pricing|reprice/i.test(heading)
      ? pricingRowsFromPlanDetail(detail)
      : [];

    if (priceRows.length >= 2) {
      prices.push(...priceRows);
      continue;
    }

    supporting.push(step);
  }

  return { prices, supporting };
}

function PlanPage({
  plan,
  items,
  onOpenItem,
}: {
  plan: PlanPayload;
  items: CampaignItem[];
  onOpenItem: (productId?: string | null) => void;
}) {
  const overview = compactDisplayText(plan.summary, { maxChars: 150, maxSentences: 1 });
  const title = getPlanDisplayTitle(plan);
  const content = useMemo(() => planContent(plan), [plan]);
  const priceRows = useMemo(() => content.prices.map((change) => {
    const item = matchPlanItem(change.name, items);
    return {
      ...change,
      item,
      before: change.before && change.before !== 'Not shown' ? change.before : (campaignItemPrice(item) || 'Not shown'),
    };
  }), [content.prices, items]);

  if (!overview && !priceRows.length && !content.supporting.length) {
    return <EmptyNote text="Sprout will run this once you approve." />;
  }

  return (
    <View style={styles.docPage}>
      {overview ? (
        <View style={styles.docIntro}>
          <Text style={styles.docIntroTitle}>{title || 'Proposed changes'}</Text>
          <Text style={styles.docIntroText}>{overview}</Text>
        </View>
      ) : null}
      {priceRows.length ? (
        <View style={styles.planChangesSection}>
          <Text style={styles.docHeading}>Changes</Text>
          <View style={styles.planChangesSurface}>
            {priceRows.length ? (
              <>
                <View style={styles.planTableHeader}>
                  <Text style={[styles.planColumnLabel, styles.flex]}>PRODUCT</Text>
                  <Text style={styles.planPriceColumnLabel}>BEFORE</Text>
                  <Text style={styles.planPriceColumnLabel}>AFTER</Text>
                </View>
                {priceRows.map((change, index) => (
                  <Pressable
                    key={`${change.name}-${index}`}
                    style={[styles.planProductRow, index > 0 && styles.planRowDivider]}
                    disabled={!change.item?.productId}
                    onPress={() => onOpenItem(change.item?.productId)}
                    accessibilityRole={change.item?.productId ? 'button' : undefined}
                    accessibilityLabel={change.item?.productId ? `Open ${change.name}` : undefined}
                  >
                    {change.item?.imageUrl ? (
                      <Image source={{ uri: change.item.imageUrl }} style={styles.planProductImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.planProductImageFallback}>
                        <Icon name="package-variant-closed" size={20} color={CHAT_COLORS.faint} />
                      </View>
                    )}
                    <View style={styles.planProductIdentity}>
                      <Text style={styles.planProductName} numberOfLines={2}>{change.name}</Text>
                      <Text style={styles.planProductApproach} numberOfLines={1}>{change.approach}</Text>
                    </View>
                    <Text style={styles.planBeforePrice}>{change.before}</Text>
                    <Text style={styles.planAfterPrice}>{change.after}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ── Document page: the report reads as a narrative, then ends with one next step.

function DocumentPage({
  document,
  mode,
  draft,
  onChangeDraft,
  onRevise,
  onRequestClose,
  documentAction,
}: {
  document: ReportDocument;
  mode: 'preview' | 'code';
  draft: string;
  onChangeDraft: (v: string) => void;
  onRevise?: (documentId: string, title: string, note: string) => void;
  onRequestClose?: () => void;
  documentAction?: { label: string; description?: string; onPress: () => void };
}) {
  const [reviseOpen, setReviseOpen] = useState(false);
  const [note, setNote] = useState('');

  const submitRevise = () => {
    const n = note.trim();
    if (!n) return;
    onRevise?.(document.documentId, document.title, n);
    setReviseOpen(false);
    setNote('');
    onRequestClose?.();
  };

  const reading = useMemo(() => organizeReportDocument(document), [document]);
  const actionLabel = useMemo(() => {
    const label = sanitizeDisplayText(documentAction?.label);
    return label.length <= 20 && label.split(/\s+/).length <= 3 ? label : 'Open chat';
  }, [documentAction?.label]);

  return (
    <View style={styles.docPage}>
      {mode === 'preview' && reading.overview ? (
        <View style={styles.docIntro}>
          <Text style={styles.docKicker}>IN SHORT</Text>
          <Text style={styles.docIntroTitle}>What this means</Text>
          <Markdown style={{ body: styles.docIntroText as any }}>{reading.overview}</Markdown>
        </View>
      ) : null}

      {mode === 'code' ? (
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          style={styles.docEditor}
          textAlignVertical="top"
          placeholder="Report markdown"
          placeholderTextColor={CHAT_COLORS.faint}
        />
      ) : (
        <View style={styles.docSections}>
          {reading.sections.map((section, index) => (
            <DocumentSectionView key={index} section={section} />
          ))}
          {!reading.sections.length && !reading.overview ? <EmptyNote text="This report has no sections yet." /> : null}
        </View>
      )}

      {onRevise ? (
        reviseOpen ? (
          <View style={styles.docRevise}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Describe the changes you want"
              placeholderTextColor={CHAT_COLORS.faint}
              style={styles.docReviseInput}
              multiline
              autoFocus
            />
            <View style={styles.docReviseRow}>
              <TouchableOpacity onPress={() => { setReviseOpen(false); setNote(''); }} activeOpacity={0.8}>
                <Text style={styles.docReviseCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.docReviseSend, !note.trim() && { opacity: 0.5 }]}
                disabled={!note.trim()}
                onPress={submitRevise}
                activeOpacity={0.85}
              >
                <Text style={styles.docReviseSendText}>Send changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.docReviseCta} onPress={() => setReviseOpen(true)} activeOpacity={0.85}>
            <Icon name="pencil-outline" size={17} color={CHAT_COLORS.inkSoft} />
            <Text style={styles.docReviseCtaText}>Request changes</Text>
            <Icon name="chevron-right" size={18} color={CHAT_COLORS.faint} />
          </TouchableOpacity>
        )
      ) : null}

      {documentAction ? (
        <View style={styles.docActionBlock}>
          {documentAction.description ? (
            <Text style={styles.docActionDescription}>
              {compactDisplayText(documentAction.description, { maxChars: 130, maxSentences: 1 })}
            </Text>
          ) : null}
          <Pressable
            style={styles.docActionButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              documentAction.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={sanitizeDisplayText(documentAction.label)}
          >
            <Text style={styles.docActionButtonText}>{actionLabel}</Text>
            <Icon name="arrow-right" size={18} color={CHAT_COLORS.white} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// One row in the document "···" dropdown. `active` marks the current view (Preview / Edit).
function DocMenuItem({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} activeOpacity={0.6} onPress={onPress}>
      <Icon name={icon} size={18} color={active ? CHAT_COLORS.brandDeep : CHAT_COLORS.inkSoft} />
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{label}</Text>
      {active ? <Icon name="check" size={16} color={CHAT_COLORS.brandDeep} style={{ marginLeft: 'auto' }} /> : null}
    </TouchableOpacity>
  );
}

function DocumentSectionView({ section }: { section: ReportDocument['sections'][number] }) {
  const heading = reportSectionHeading(section);
  return (
    <View style={styles.docSection}>
      {heading ? <Text style={styles.docHeading}>{heading}</Text> : null}
      {section.kind === 'prose' ? (
        <Markdown style={{ body: styles.docProse as any }}>{section.text || ''}</Markdown>
      ) : null}
      {section.kind === 'metrics' ? (
        <View style={styles.docMetrics}>
          {section.metrics.map((m, i) => (
            <View key={i} style={styles.docMetricTile}>
              <Text style={styles.docMetricValue} numberOfLines={1}>{m.value}</Text>
              <Text style={styles.docMetricLabel} numberOfLines={2}>{m.label}</Text>
              {m.sub ? <Text style={styles.docMetricSub} numberOfLines={1}>{m.sub}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {section.kind === 'table' ? (
        // Real column widths (first column wider for row labels) so a table with many
        // columns extends past the screen and scrolls, with a fade marking there's more.
        <HorizontalFadeScroll fadeColor={CHAT_COLORS.white} style={styles.docTableScroll}>
          <View style={styles.docTable}>
            {section.columns.length ? (
              <View style={[styles.docTableRow, styles.docTableHead]}>
                {section.columns.map((c, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.docTableCell,
                      i === 0 && styles.docTableCellFirst,
                      /basis|why|strategy|reason|notes?/i.test(c) && styles.docTableCellWide,
                      styles.docTableHeadCell,
                    ]}
                    numberOfLines={2}
                  >
                    {c}
                  </Text>
                ))}
              </View>
            ) : null}
            {section.rows.map((row, ri) => (
              <View key={ri} style={[styles.docTableRow, ri % 2 === 1 && styles.docTableRowAlt]}>
                {row.map((cell, ci) => (
                  <Text
                    key={ci}
                    style={[
                      styles.docTableCell,
                      ci === 0 && styles.docTableCellFirst,
                      /basis|why|strategy|reason|notes?/i.test(section.columns[ci] || '') && styles.docTableCellWide,
                      /before|current/i.test(section.columns[ci] || '') && styles.docTableBeforeCell,
                      /after|new price/i.test(section.columns[ci] || '') && styles.docTableAfterCell,
                    ]}
                    numberOfLines={3}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </HorizontalFadeScroll>
      ) : null}
    </View>
  );
}

// ── Footer (per page) ────────────────────────────────────────────────────

function Footer({
  page,
  payload,
  insetBottom,
  confirmUndo,
  onAskUndo,
  onCancelUndo,
  onConfirmUndo,
  onOpenItem,
  onRoutineAction,
  onApprovePlan,
  planSubmitting,
}: {
  page: TrayPage;
  payload: ActivityPayload;
  insetBottom: number;
  confirmUndo: boolean;
  onAskUndo: () => void;
  onCancelUndo: () => void;
  onConfirmUndo: (change?: ValueChange) => void;
  onOpenItem: (productId?: string | null) => void;
  onRoutineAction: (action: 'pause' | 'resume' | 'edit' | 'delete' | 'cancel') => void;
  onApprovePlan: (action: 'approve' | 'revise' | 'follow_up') => void;
  planSubmitting: boolean;
}) {
  // The document's actions live in its header "···" menu + inline "Ask Sprout to revise".
  if (payload.kind === 'document') return null;
  const pad = { paddingBottom: insetBottom };

  // Plan approval stays singular. Editing lives in the header and returns to chat.
  if (payload.kind === 'plan') {
    return (
      <View style={[styles.footer, pad]}>
        <TouchableOpacity
          style={[styles.planApprove, planSubmitting && styles.planButtonDisabled]}
          onPress={() => onApprovePlan('approve')}
          activeOpacity={0.85}
          disabled={planSubmitting}
        >
          <Text style={styles.planApproveText}>{planSubmitting ? 'Applying…' : 'Apply changes'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Routine controls
  if (payload.kind === 'routine') {
    const paused = !!payload.routine.paused;
    return (
      <View style={[styles.footer, pad]}>
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => onRoutineAction(paused ? 'resume' : 'pause')}>
            <Icon name={paused ? 'play' : 'pause'} size={15} color={CHAT_COLORS.ink} />
            <Text style={styles.ghostBtnText}>{paused ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => onRoutineAction('edit')}>
            <Icon name="pencil-outline" size={15} color={CHAT_COLORS.ink} />
            <Text style={styles.ghostBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.dangerGhost} onPress={() => onRoutineAction('delete')}>
          <Text style={styles.dangerGhostText}>Delete routine</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (payload.kind === 'reminder') {
    return (
      <View style={[styles.footer, pad]}>
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => onRoutineAction('edit')}>
            <Icon name="pencil-outline" size={15} color={CHAT_COLORS.ink} />
            <Text style={styles.ghostBtnText}>Edit time</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerGhost} onPress={() => onRoutineAction('cancel')}>
            <Text style={styles.dangerGhostText}>Cancel reminder</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // value-change / publish — resolve undo + open-item availability for this page.
  const change = page.kind === 'change-detail' ? page.change : undefined;
  const undoRef = payload.kind === 'value-change' ? payload.undo : undefined;
  const itemRef = payload.kind === 'value-change' || payload.kind === 'publish' ? payload.itemRef : undefined;
  const productId = change?.productId || itemRef?.productId;
  const isBatch = payload.kind === 'value-change' && (payload.changes?.length ?? 0) > 1 && page.kind === 'root';

  const canUndo = !!undoRef && (page.kind === 'root');
  const canOpen = !!productId;
  if (!canUndo && !canOpen) return <View style={pad} />;

  if (confirmUndo) {
    const label = undoRef?.revertLabel || 'Undo this change?';
    return (
      <View style={[styles.footer, pad]}>
        <Text style={styles.confirmText}>{label}</Text>
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.ghostBtn} onPress={onCancelUndo}>
            <Text style={styles.ghostBtnText}>Keep it</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={() => onConfirmUndo(change)}>
            <Text style={styles.confirmBtnText}>Yes, undo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.footer, pad]}>
      <View style={styles.footerRow}>
        {canUndo ? (
          <TouchableOpacity style={styles.undoBtn} onPress={onAskUndo}>
            <Icon name="undo-variant" size={15} color={CHAT_COLORS.errorDeep} />
            <Text style={styles.undoBtnText}>{isBatch ? `Undo all ${payload.kind === 'value-change' ? payload.changes.length : ''}` : 'Undo'}</Text>
          </TouchableOpacity>
        ) : null}
        {canOpen ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => onOpenItem(productId)}>
            <Text style={styles.primaryBtnText}>Open item</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────

const ReasonBanner = ({ text }: { text: string }) => (
  <View style={styles.reasonBanner}>
    <Icon name="information-outline" size={15} color={CHAT_COLORS.brandDeep} style={{ marginTop: 1 }} />
    <Text style={styles.reasonText}>{text}</Text>
  </View>
);

const ItemIdentity = ({ itemRef }: { itemRef: { productId: string; name?: string; imageUrl?: string; listingCount?: number } }) => (
  <View style={styles.identityRow}>
    {itemRef.imageUrl ? (
      <Image source={{ uri: itemRef.imageUrl }} style={styles.identityThumb} />
    ) : (
      <View style={[styles.identityThumb, styles.listThumbFallback]}>
        <Icon name="package-variant" size={20} color={CHAT_COLORS.brandDeep} />
      </View>
    )}
    <View style={styles.flex}>
      <Text style={styles.identityName} numberOfLines={1}>{itemRef.name}</Text>
      {itemRef.listingCount ? (
        <Text style={styles.identitySub}>Listed on {itemRef.listingCount} channel{itemRef.listingCount === 1 ? '' : 's'}</Text>
      ) : null}
    </View>
  </View>
);

const DetailRow = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Icon name={icon} size={17} color={CHAT_COLORS.dim} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
  </View>
);

const EmptyNote = ({ text }: { text: string }) => (
  <View style={styles.emptyNote}>
    <Text style={styles.emptyNoteText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: '#000000' },
  sheet: {
    backgroundColor: CHAT_COLORS.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  grabberZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: CHAT_COLORS.border },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 12,
    gap: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  headerTitle: { fontSize: 18, fontFamily: CHAT_FONT.bold, color: CHAT_COLORS.ink, flexShrink: 1 },
  planHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
  },
  planHeaderTitle: { flex: 1, marginRight: 10, fontSize: 18, fontFamily: CHAT_FONT.bold, color: CHAT_COLORS.ink },
  planHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  tileFail: { backgroundColor: CHAT_COLORS.errorSurface },
  tileSync: { backgroundColor: 'rgba(245,158,11,0.14)' },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CHAT_COLORS.bubble,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 20 },

  // hero change block
  heroBlock: { gap: 10 },
  heroLabel: { fontSize: 12, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.dim, letterSpacing: 0.4, textTransform: 'uppercase' },
  detailBlock: { gap: 8 },

  // item identity
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CHAT_COLORS.surface,
    borderRadius: 14,
    padding: 12,
  },
  identityThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: CHAT_COLORS.bubble },
  identityName: { fontSize: 14, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },
  identitySub: { fontSize: 12, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, marginTop: 2 },

  // reason banner
  reasonBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: CHAT_COLORS.brandSoft,
    borderRadius: 12,
    padding: 12,
  },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.brandDeep },

  // drill row
  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CHAT_COLORS.divider,
  },
  drillText: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.inkSoft },

  // batch list rows
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  listThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: CHAT_COLORS.bubble },
  listThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  listName: { fontSize: 13.5, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },

  // evidence
  evidenceHeadline: { fontSize: 14, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink, lineHeight: 20 },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  evidenceThumb: { width: 38, height: 38, borderRadius: 8, backgroundColor: CHAT_COLORS.bubble },
  evidenceLabel: { fontSize: 13, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.inkSoft },
  evidenceSub: { fontSize: 11.5, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, marginTop: 1 },
  evidenceValue: { fontSize: 13, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },

  // tool-run steps overview + step detail
  reasoningBlock: { backgroundColor: CHAT_COLORS.surface, borderRadius: 12, padding: 12, gap: 6 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasoningHeadText: { fontSize: 12.5, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.brandDeep },
  reasoningBody: { fontSize: 13, lineHeight: 19, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.inkSoft },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  stepChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  stepChipFail: { backgroundColor: CHAT_COLORS.errorSurface },
  stepLabel: { fontSize: 13, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.inkSoft },
  stepResult: { fontSize: 11.5, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.faint, marginTop: 1 },
  stepFail: { fontSize: 11, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.error },
  stepMeta: { fontSize: 11, fontFamily: CHAT_FONT.medium, color: '#A1A1AA' },
  stepDetailSummary: { fontSize: 14, lineHeight: 20, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.inkSoft },
  outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outcomePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: CHAT_COLORS.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  outcomePillFail: { backgroundColor: CHAT_COLORS.errorSurface },
  outcomeText: { fontSize: 12, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.brandDeep },
  outcomeMeta: { fontSize: 12, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.faint },
  resultLineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  resultDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: CHAT_COLORS.brand, marginTop: 7 },
  resultLine: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.inkSoft },
  resultItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CHAT_COLORS.surface,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  resultItemLabel: { fontSize: 13, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.ink },
  resultItemSub: { fontSize: 11.5, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, marginTop: 1 },
  resultItemValue: { fontSize: 13, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.brandDeep },

  // channels
  sectionLabel: { fontSize: 11, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.dim, letterSpacing: 0.4 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CHAT_COLORS.surface,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  channelName: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.ink },

  // routine/reminder detail
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: 13, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.dim, width: 78 },
  detailValue: { flex: 1, fontSize: 14, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },
  statusNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CHAT_COLORS.brandSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 2,
  },
  statusNotePaused: { backgroundColor: CHAT_COLORS.surface },
  statusNoteText: { fontSize: 13, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.brandDeep },

  emptyNote: { paddingVertical: 28, alignItems: 'center' },
  emptyNoteText: { fontSize: 13.5, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, textAlign: 'center' },

  // plan approval footer
  planApprove: {
    height: 52,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planApproveText: { color: '#FFFFFF', fontSize: 15, fontFamily: CHAT_FONT.bold },
  planButtonDisabled: { opacity: 0.5 },

  // footer
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CHAT_COLORS.divider,
    backgroundColor: CHAT_COLORS.white,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // ── Document page ──
  docPage: { gap: 14 },
  docIntro: {
    gap: 6,
    paddingHorizontal: 0,
    paddingVertical: 6,
  },
  docKicker: { fontSize: 10.5, letterSpacing: 0.8, color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.bold },
  docIntroTitle: { fontSize: 18, lineHeight: 23, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold },
  docIntroText: { fontSize: 15, lineHeight: 22, color: CHAT_COLORS.inkSoft, fontFamily: CHAT_FONT.regular },
  docSections: { gap: 14 },
  planChangesSection: { gap: 10 },
  planChangesSurface: {
    overflow: 'hidden',
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    backgroundColor: CHAT_COLORS.white,
  },
  planTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: CHAT_COLORS.surface,
  },
  planColumnLabel: {
    fontSize: 10,
    letterSpacing: 0.55,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.bold,
  },
  planPriceColumnLabel: {
    width: 54,
    textAlign: 'right',
    fontSize: 10,
    letterSpacing: 0.4,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.bold,
  },
  planProductRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  planRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CHAT_COLORS.divider,
  },
  planProductImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: CHAT_COLORS.surface,
  },
  planProductImageFallback: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CHAT_COLORS.surface,
  },
  planProductIdentity: { flex: 1, minWidth: 70, gap: 2 },
  planProductName: {
    fontSize: 13,
    lineHeight: 17,
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.semibold,
  },
  planProductApproach: {
    fontSize: 11.5,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.regular,
  },
  planBeforePrice: {
    width: 54,
    textAlign: 'right',
    fontSize: 12.5,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.medium,
  },
  planAfterPrice: {
    width: 54,
    textAlign: 'right',
    fontSize: 13.5,
    color: CHAT_COLORS.brandDeep,
    fontFamily: CHAT_FONT.bold,
  },
  docSection: {
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHAT_COLORS.border,
  },
  docEditor: {
    minHeight: 240,
    fontSize: 13.5,
    lineHeight: 20,
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.regular,
    backgroundColor: CHAT_COLORS.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    padding: 12,
  },
  docHeading: { fontSize: 17, lineHeight: 22, fontFamily: CHAT_FONT.bold, color: CHAT_COLORS.ink },
  docProse: { fontSize: 14.5, lineHeight: 22, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.regular },
  // Document-viewer header (close · centered title · "···") + its dropdown menu.
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 12,
    gap: 10,
  },
  docHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontFamily: CHAT_FONT.bold, color: CHAT_COLORS.ink },
  menuScrim: { ...StyleSheet.absoluteFillObject, zIndex: 40 },
  menu: {
    position: 'absolute',
    top: 58,
    right: 14,
    minWidth: 190,
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    zIndex: 50,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  menuItemText: { fontSize: 14.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.ink },
  menuItemTextActive: { color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.semibold },
  menuDivider: { height: 1, backgroundColor: CHAT_COLORS.divider, marginVertical: 5, marginHorizontal: 10 },
  docRevise: {
    gap: 10,
    backgroundColor: CHAT_COLORS.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    padding: 12,
  },
  docReviseInput: { minHeight: 60, fontSize: 14, lineHeight: 20, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.regular },
  docReviseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  docReviseCancel: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.dim },
  docReviseSend: { backgroundColor: CHAT_COLORS.brandDeep, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  docReviseSendText: { fontSize: 13.5, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.white },
  docReviseCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CHAT_COLORS.surfaceAlt,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 13,
    marginTop: 2,
  },
  docReviseCtaText: { flex: 1, fontSize: 14, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },
  docActionBlock: {
    gap: 6,
    paddingTop: 2,
    paddingBottom: 8,
  },
  docActionKicker: { fontSize: 10.5, letterSpacing: 0.8, color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.bold },
  docActionTitle: { fontSize: 19, lineHeight: 24, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold },
  docActionDescription: { fontSize: 14, lineHeight: 20, color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular },
  docActionButton: {
    minHeight: 52,
    marginTop: 8,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: CHAT_COLORS.brand,
    borderRadius: 26,
    borderCurve: 'continuous',
  },
  docActionButtonText: { fontSize: 15, color: CHAT_COLORS.white, fontFamily: CHAT_FONT.bold },
  docMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  docMetricTile: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: CHAT_COLORS.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    padding: 10,
    gap: 2,
  },
  docMetricValue: { fontSize: 18, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },
  docMetricLabel: { fontSize: 11.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.dim },
  docMetricSub: { fontSize: 10.5, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.faint },
  docTableScroll: { marginHorizontal: -2 },
  docTable: { borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  docTableRow: { flexDirection: 'row' },
  docTableHead: { backgroundColor: CHAT_COLORS.surface },
  docTableRowAlt: { backgroundColor: CHAT_COLORS.surfaceAlt },
  docTableCell: {
    width: 108,
    fontSize: 12,
    lineHeight: 17,
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.regular,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#ECEBE6',
  },
  docTableCellFirst: { width: 148 },
  docTableCellWide: { width: 190 },
  docTableHeadCell: { fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.dim },
  docTableBeforeCell: { color: CHAT_COLORS.dim },
  docTableAfterCell: { color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.bold },
  primaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: CHAT_FONT.bold },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CHAT_COLORS.errorBorder,
    backgroundColor: CHAT_COLORS.white,
  },
  undoBtnText: { color: CHAT_COLORS.errorDeep, fontSize: 14, fontFamily: CHAT_FONT.semibold },
  ghostBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.bubble,
  },
  ghostBtnText: { color: CHAT_COLORS.ink, fontSize: 14, fontFamily: CHAT_FONT.semibold },
  dangerGhost: {
    height: 48,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.bubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerGhostText: { color: CHAT_COLORS.errorDeep, fontSize: 14, fontFamily: CHAT_FONT.semibold },
  confirmText: { fontSize: 14, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink, textAlign: 'center' },
  confirmBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.errorDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: CHAT_FONT.bold },
});
