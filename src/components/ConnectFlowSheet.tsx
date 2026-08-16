/**
 * ConnectFlowSheet — the ONE reusable connect flow.
 *
 * Presents a platform's required connect steps (from connectStepsFor) as a single
 * continuous sheet: OAuth login, then — for computer-write platforms like
 * Facebook Marketplace — linking the user's computer. Steps already satisfied are
 * skipped, so re-opening a half-connected platform drops the user straight on the
 * step that remains. Reuses PlatformConsentBody (OAuth) + LinkComputerBody /
 * LinkComputerScanSheet (computer) verbatim, so nothing is a Facebook one-off:
 * any platform that gains writeVia:'computer' gets this exact flow for free.
 *
 * COPY = outcome, never plumbing (feedback_no_internal_leak): "your computer".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import PlatformLogo from './PlatformLogo';
import { PlatformConsentBody } from './PlatformConnectSheet';
import { LinkComputerBody } from './LinkComputerSheet';
import LinkComputerScanSheet from './LinkComputerScanSheet';
import ShopifyStorePicker from './ShopifyStorePicker';
import { usePlatformConnect, ConnectablePlatform } from '../hooks/usePlatformConnect';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { refreshInboxSummary, useImportStatus } from '../hooks/useImportStatus';
import { usePlatformConnectStatus } from '../hooks/usePlatformConnectStatus';
import { getPlatform, connectStepsFor, type ConnectStepKind } from '../config/platforms';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  connectionImportPresentationsById,
  latestImportsByConnection,
} from '../lib/connectionImportPresentation';

type FlowPhase = 'consent' | 'shopifyPicker' | 'connecting' | 'importing' | 'importFailed' | 'linkComputer' | 'done';

interface Props {
  visible: boolean;
  /** Canonical platform spelling, or null when nothing is selected. */
  platform: string | null;
  orgId?: string | null;
  /** Backed out before finishing (soft — never an error). */
  onCancel: () => void;
  /** All required steps are satisfied (or the user finished the flow). */
  onConnected: (connectionId?: string) => void;
  /** Opens the existing import retry state for this connected account. */
  retryConnectionId?: string | null;
}

const TEXT_SECONDARY = '#6B7280';

export default function ConnectFlowSheet({
  visible,
  platform,
  orgId,
  onCancel,
  onConnected,
  retryConnectionId = null,
}: Props) {
  const { connect, startScan } = usePlatformConnect({ orgId });
  const { connections, progressByConnectionId, refresh } = usePlatformConnections();
  const importStatus = useImportStatus();
  const presentationByConnectionId = useMemo(
    () => connectionImportPresentationsById({
      connections,
      aggregateConnections: importStatus.connections,
      recentImports: importStatus.recentImports,
      progressByConnectionId,
    }),
    [connections, importStatus.connections, importStatus.recentImports, progressByConnectionId],
  );
  const statusOptions = useMemo(
    () => ({ presentationByConnectionId }),
    [presentationByConnectionId],
  );
  const status = usePlatformConnectStatus(platform || '', statusOptions);
  const statusRef = useRef(status);
  statusRef.current = status;

  const [phase, setPhase] = useState<FlowPhase>('consent');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [failedConnectionId, setFailedConnectionId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const connectedConnectionIdRef = useRef<string | undefined>(undefined);
  const importStartedAtRef = useRef<number | null>(null);
  const importObservedRef = useRef(false);
  const importPendingRef = useRef(false);

  const steps = platform ? connectStepsFor(platform) : [];
  const def = platform ? getPlatform(platform) : undefined;

  // Initialize the phase whenever the sheet opens for a platform: skip any step
  // that is already satisfied so a half-connected platform resumes where it left
  // off. Reads latest status via ref (not a dep) so mid-flow status updates never
  // reset the phase under the user.
  useEffect(() => {
    if (!visible || !platform) return;
    const s = statusRef.current;
    setConnectError(null);
    setFailedConnectionId(null);
    setScanOpen(false);
    connectedConnectionIdRef.current = retryConnectionId || undefined;
    importStartedAtRef.current = null;
    importObservedRef.current = false;
    importPendingRef.current = false;
    if (retryConnectionId) {
      setFailedConnectionId(retryConnectionId);
      setPhase('importFailed');
    } else if (!s.oauthConnected && s.steps.includes('oauth')) {
      setPhase('consent');
    } else if (s.requiresComputer && !s.computerOnline) {
      setPhase('linkComputer');
    } else if (s.importing) {
      importPendingRef.current = true;
      importObservedRef.current = true;
      setPhase('importing');
    } else {
      setPhase('done');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, platform, retryConnectionId]);

  const finish = useCallback(() => {
    importPendingRef.current = false;
    setPhase('done');
    onConnected(connectedConnectionIdRef.current);
  }, [onConnected]);

  // Required setup stays first. Once it is satisfied, a server-confirmed scan
  // gets its own dismissible phase until the shared import sources turn terminal.
  const advanceAfterSetup = useCallback(() => {
    const s = statusRef.current;
    if (s.requiresComputer && !s.computerOnline) {
      setPhase('linkComputer');
    } else if (importPendingRef.current) {
      setPhase('importing');
    } else {
      finish();
    }
  }, [finish]);

  // Auto-finish if the computer comes online while we're on the link step: the
  // user may open/link their computer out of band, or presence may just arrive.
  // Without this the sheet would sit on "Link your computer" until manually closed.
  useEffect(() => {
    if (phase === 'linkComputer' && status.computerOnline) {
      advanceAfterSetup();
    }
  }, [phase, status.computerOnline, advanceAfterSetup]);

  // The start-scan response establishes that work began. Completion still comes
  // only from the shared connection/import stores. This effect never estimates
  // progress and never cancels the scan when the sheet is dismissed.
  useEffect(() => {
    if (phase !== 'importing') return;

    const connectionId = connectedConnectionIdRef.current;
    const latestImport = connectionId
      ? latestImportsByConnection(importStatus.recentImports).get(connectionId)
      : undefined;
    const presentation = connectionId
      ? presentationByConnectionId.get(connectionId)
      : undefined;
    const attemptStartedAt = importStartedAtRef.current;
    const createdAt = latestImport ? Date.parse(latestImport.createdAt) : Number.NaN;
    const completedAt = latestImport?.completedAt
      ? Date.parse(latestImport.completedAt)
      : Number.NaN;
    const presentationAt = presentation?.occurredAt
      ? Date.parse(presentation.occurredAt)
      : Number.NaN;
    const belongsToAttempt = attemptStartedAt == null
      || (!Number.isNaN(createdAt) && createdAt >= attemptStartedAt)
      || (!Number.isNaN(completedAt) && completedAt >= attemptStartedAt)
      || (!Number.isNaN(presentationAt) && presentationAt >= attemptStartedAt);
    const importIsActive = status.importing || presentation?.importInProgress === true;

    if (belongsToAttempt && latestImport) {
      const runStatus = latestImport.status.trim().toLowerCase();
      const runFailed = runStatus === 'error' || runStatus.includes('fail');
      const runSucceeded = ['complete', 'completed', 'success', 'succeeded'].includes(runStatus);
      if (latestImport.completedAt || runFailed || runSucceeded) {
        if (runFailed) {
          setFailedConnectionId(connectionId || null);
          setConnectError('Import stopped.');
          setPhase('importFailed');
        } else {
          finish();
        }
        return;
      }
    }

    if (importIsActive) {
      importObservedRef.current = true;
      return;
    }

    if (importObservedRef.current) {
      if (belongsToAttempt && presentation?.kind === 'failed') {
        setFailedConnectionId(connectionId || null);
        setConnectError('Import stopped.');
        setPhase('importFailed');
      } else {
        finish();
      }
    }
  }, [phase, status.importing, importStatus.recentImports, presentationByConnectionId, finish]);

  const completeOAuth = useCallback(async (shopifyShop?: string) => {
    if (!platform) return;
    setPhase('connecting');
    setConnectError(null);
    importStartedAtRef.current = Date.now();
    importObservedRef.current = false;
    importPendingRef.current = false;
    try {
      const res = await connect(platform as ConnectablePlatform, { shopifyShop });
      if (res.success) {
        connectedConnectionIdRef.current = res.connectionId;
        // Awaited: advanceAfterSetup reads connect status derived from this
        // context, so advancing before the refresh lands renders stale state.
        await Promise.all([refresh(), refreshInboxSummary()]);
        // The inbox summary must move with the new connection (shared store —
        // every mounted consumer updates), not wait for the next focus/poll.
        // Nudge once more after the callback row commits, then decide next step.
        setTimeout(() => {
          refresh?.();
          void refreshInboxSummary();
        }, 2500);
        if (res.connectionId && res.scanStarted === false) {
          setFailedConnectionId(res.connectionId);
          setConnectError('Import did not start.');
          setPhase('importFailed');
          return;
        }
        importPendingRef.current = res.scanStarted !== false;
        advanceAfterSetup();
      } else if (res.cancelled) {
        setPhase('consent');
      } else {
        setConnectError(res.errorMessage || 'Connection failed. Please try again.');
        setPhase('consent');
      }
    } catch {
      setConnectError('Something went wrong. Please try again.');
      setPhase('consent');
    }
  }, [platform, connect, refresh, advanceAfterSetup]);

  const runOAuth = useCallback(() => {
    if (platform === 'shopify') {
      setConnectError(null);
      setPhase('shopifyPicker');
      return;
    }
    void completeOAuth();
  }, [platform, completeOAuth]);

  const retryImport = useCallback(async () => {
    if (!failedConnectionId) return;
    setConnectError(null);
    setPhase('connecting');
    importStartedAtRef.current = Date.now();
    importObservedRef.current = false;
    const started = await startScan(failedConnectionId);
    if (started) {
      connectedConnectionIdRef.current = failedConnectionId;
      importPendingRef.current = true;
      await Promise.all([refresh(), refreshInboxSummary()]);
      advanceAfterSetup();
      return;
    }
    setConnectError('Import did not start.');
    setPhase('importFailed');
  }, [failedConnectionId, startScan, refresh, advanceAfterSetup]);

  if (!platform || !def) return null;

  // Combined progress: "Step N of M" only when there is more than one step.
  const currentKind: ConnectStepKind | null =
    phase === 'consent' || phase === 'shopifyPicker' || phase === 'connecting'
      ? 'oauth'
      : phase === 'linkComputer'
        ? 'linkComputer'
        : null;
  const stepIndex = currentKind ? steps.indexOf(currentKind) : -1;
  const showStepCount = steps.length > 1 && stepIndex >= 0;

  return (
    <>
      <BaseModal visible={visible && !scanOpen && phase !== 'shopifyPicker'} onClose={onCancel} position="bottom" showCloseButton={false} containerStyle={styles.sheet}>
        <View style={styles.handle} />

        {/* Header: platform + combined step progress + close */}
        <View style={styles.header}>
          <View style={styles.headerLogo}>
            <PlatformLogo type={platform} size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Connect {def.label}</Text>
            {showStepCount ? (
              <Text style={styles.headerStep}>
                Step {stepIndex + 1} of {steps.length}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.closeCircle}
            onPress={onCancel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={18} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        </View>

        {phase === 'consent' || phase === 'connecting' ? (
          <PlatformConsentBody
            platform={platform}
            busy={phase === 'connecting'}
            error={connectError}
            onContinue={runOAuth}
          />
        ) : null}

        {phase === 'linkComputer' ? (
          <View>
            <LinkComputerBody orgId={orgId || undefined} hideSkip onDone={advanceAfterSetup} />
            <TouchableOpacity style={styles.scanBtn} onPress={() => setScanOpen(true)} activeOpacity={0.85}>
              <Icon name="qrcode-scan" size={18} color={BRAND_PRIMARY} />
              <Text style={styles.scanBtnText}>Scan the code on your computer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.laterBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.laterText}>Do this later</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === 'importing' ? (
          <View style={styles.importFailedWrap}>
            <Icon name="progress-clock" size={34} color="#A2611A" />
            <Text style={styles.importFailedTitle}>Importing items</Text>
            <Text style={styles.importFailedText}>Safe to close. Keeps going.</Text>
            <TouchableOpacity style={styles.laterBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.laterText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === 'importFailed' ? (
          <View style={styles.importFailedWrap}>
            <Icon name="alert-circle-outline" size={34} color="#BA7517" />
            <Text style={styles.importFailedTitle}>Import failed</Text>
            {connectError ? <Text style={styles.importFailedText}>{connectError}</Text> : null}
            <TouchableOpacity style={styles.retryBtn} onPress={retryImport} activeOpacity={0.85}>
              <Text style={styles.retryBtnText}>Retry import</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.laterBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.laterText}>Do this later</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {phase === 'done' ? (
          <View style={styles.doneWrap}>
            <Icon name="check-circle" size={40} color={BRAND_PRIMARY} />
            <Text style={styles.doneText}>All set</Text>
          </View>
        ) : null}
      </BaseModal>

      <ShopifyStorePicker
        visible={visible && phase === 'shopifyPicker'}
        onCancel={() => setPhase('consent')}
        onStore={(handle) => void completeOAuth(handle)}
      />

      {/* QR pairing rides on top; hides the flow sheet while open. */}
      <LinkComputerScanSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onLinked={() => {
          setScanOpen(false);
          advanceAfterSetup();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingTop: 12, paddingBottom: 28, paddingHorizontal: 20, backgroundColor: '#FFFFFF' },
  handle: { width: 40, height: 5, borderRadius: 999, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F6F7F4',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#18181B', letterSpacing: -0.2 },
  headerStep: { fontSize: 12.5, color: TEXT_SECONDARY, marginTop: 1, fontWeight: '600' },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F4F4F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 12,
  },
  scanBtnText: { color: '#18181B', fontSize: 15, fontWeight: '700' },
  laterBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  laterText: { color: TEXT_SECONDARY, fontSize: 14, fontWeight: '600' },
  doneWrap: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  doneText: { fontSize: 16, fontWeight: '700', color: '#18181B' },
  importFailedWrap: { alignItems: 'center', paddingVertical: 20 },
  importFailedTitle: { marginTop: 10, fontSize: 17, fontWeight: '700', color: '#18181B' },
  importFailedText: { marginTop: 6, maxWidth: 300, textAlign: 'center', fontSize: 14, lineHeight: 20, color: TEXT_SECONDARY },
  retryBtn: { marginTop: 18, minHeight: 50, alignSelf: 'stretch', borderRadius: 14, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' },
  retryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
