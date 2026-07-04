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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import PlatformLogo from './PlatformLogo';
import { PlatformConsentBody } from './PlatformConnectSheet';
import { LinkComputerBody } from './LinkComputerSheet';
import LinkComputerScanSheet from './LinkComputerScanSheet';
import { usePlatformConnect, ConnectablePlatform } from '../hooks/usePlatformConnect';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { usePlatformConnectStatus } from '../hooks/usePlatformConnectStatus';
import { getPlatform, connectStepsFor, type ConnectStepKind } from '../config/platforms';
import { BRAND_PRIMARY } from '../design/tokens';

type FlowPhase = 'consent' | 'connecting' | 'linkComputer' | 'done';

interface Props {
  visible: boolean;
  /** Canonical platform spelling, or null when nothing is selected. */
  platform: string | null;
  orgId?: string | null;
  /** Backed out before finishing (soft — never an error). */
  onCancel: () => void;
  /** All required steps are satisfied (or the user finished the flow). */
  onConnected: () => void;
}

const TEXT_SECONDARY = '#6B7280';

export default function ConnectFlowSheet({ visible, platform, orgId, onCancel, onConnected }: Props) {
  const { connect } = usePlatformConnect({ orgId });
  const { refresh } = usePlatformConnections();
  const status = usePlatformConnectStatus(platform || '');
  const statusRef = useRef(status);
  statusRef.current = status;

  const [phase, setPhase] = useState<FlowPhase>('consent');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

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
    setScanOpen(false);
    if (!s.oauthConnected && s.steps.includes('oauth')) {
      setPhase('consent');
    } else if (s.requiresComputer && !s.computerOnline) {
      setPhase('linkComputer');
    } else {
      setPhase('done');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, platform]);

  const finish = useCallback(() => {
    setPhase('done');
    onConnected();
  }, [onConnected]);

  // After OAuth: go to the computer step if this platform needs a computer and one
  // isn't already online; otherwise we're done.
  const advanceAfterOAuth = useCallback(() => {
    const s = statusRef.current;
    if (s.requiresComputer && !s.computerOnline) {
      setPhase('linkComputer');
    } else {
      finish();
    }
  }, [finish]);

  // Auto-finish if the computer comes online while we're on the link step: the
  // user may open/link their computer out of band, or presence may just arrive.
  // Without this the sheet would sit on "Link your computer" until manually closed.
  useEffect(() => {
    if (phase === 'linkComputer' && status.computerOnline) {
      finish();
    }
  }, [phase, status.computerOnline, finish]);

  const runOAuth = useCallback(async () => {
    if (!platform) return;
    setPhase('connecting');
    setConnectError(null);
    try {
      const res = await connect(platform as ConnectablePlatform);
      if (res.success) {
        refresh?.();
        // Nudge once more after the callback row commits, then decide next step.
        setTimeout(() => refresh?.(), 2500);
        advanceAfterOAuth();
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
  }, [platform, connect, refresh, advanceAfterOAuth]);

  if (!platform || !def) return null;

  // Combined progress: "Step N of M" only when there is more than one step.
  const currentKind: ConnectStepKind | null =
    phase === 'consent' || phase === 'connecting' ? 'oauth' : phase === 'linkComputer' ? 'linkComputer' : null;
  const stepIndex = currentKind ? steps.indexOf(currentKind) : -1;
  const showStepCount = steps.length > 1 && stepIndex >= 0;

  return (
    <>
      <BaseModal visible={visible && !scanOpen} onClose={onCancel} position="bottom" showCloseButton={false} containerStyle={styles.sheet}>
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
            <LinkComputerBody orgId={orgId || undefined} hideSkip onDone={finish} />
            <TouchableOpacity style={styles.scanBtn} onPress={() => setScanOpen(true)} activeOpacity={0.85}>
              <Icon name="qrcode-scan" size={18} color={BRAND_PRIMARY} />
              <Text style={styles.scanBtnText}>Scan the code on your computer</Text>
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

      {/* QR pairing rides on top; hides the flow sheet while open. */}
      <LinkComputerScanSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onLinked={() => {
          setScanOpen(false);
          finish();
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
});
