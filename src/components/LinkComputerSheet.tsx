/**
 * LinkComputerSheet — the "Link your computer" bottom sheet.
 *
 * Promotes the dead onboarding step (PonderInstallCheckStep) into a reusable
 * bottom sheet on the app's workhorse idiom (BaseModal position="bottom" +
 * grabber → title + ✕ → content → green Done; soft "Skip for now").
 *
 * COPY = outcome, not plumbing (memory rule feedback_no_internal_leak): NEVER
 * say Ponder / Chrome / browser / browser-job / runtime. We talk about "your
 * computer".
 *
 * The reachability/install probe lives in the shared <LinkComputerBody>, which
 * is ALSO rendered by the onboarding step so copy never drifts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { BRAND_PRIMARY } from '../design/tokens';

// Companion-app deep link (probe only — never shown to the user).
const COMPANION_URL_SCHEME = 'ponder://';
// Where "Get the app" sends the user. Outcome-framed download page.
const GET_APP_URL = 'https://anorha.app/computer';

// ── anorha tokens ──
const SURFACE = '#F4F4F1';
const TEXT = '#111827';
const TEXT_SECONDARY = '#6B7280';
const AMBER = '#FF9500';
const HANDLE = '#E5E7EB';

export type LinkComputerState =
  | 'checking'
  | 'installed'
  | 'not_installed'
  | 'runtime_unreachable'
  | 'unknown';

interface StateCopy {
  title: string;
  body: string;
  /** Icon + tint for the round badge. */
  icon: string;
  iconColor: string;
  /** Primary CTA label, when one applies beyond Done. */
  primaryLabel?: string;
}

const COPY: Record<LinkComputerState, StateCopy> = {
  checking: {
    title: 'Checking your computer…',
    body: 'One moment.',
    icon: 'information-outline',
    iconColor: TEXT_SECONDARY,
  },
  installed: {
    title: "Your computer's linked",
    body: 'Your listings will post automatically when it’s on.',
    icon: 'check-circle',
    iconColor: BRAND_PRIMARY,
  },
  not_installed: {
    title: 'Link your computer',
    body:
      'Posting to Facebook happens through your own computer and Facebook account, so it stays safe. Set it up once and we’ll handle the rest.',
    icon: 'alert-circle-outline',
    iconColor: AMBER,
    primaryLabel: 'Get the app',
  },
  runtime_unreachable: {
    title: "Your computer's offline",
    body:
      'It’s linked but not on right now. We’ll hold your listings and post them automatically once it’s back on.',
    icon: 'alert-circle-outline',
    iconColor: AMBER,
    primaryLabel: 'Re-check',
  },
  unknown: {
    title: "We couldn't reach your computer",
    body: 'That’s fine — you can set this up later.',
    icon: 'alert-circle-outline',
    iconColor: AMBER,
    primaryLabel: 'Re-check',
  },
};

// ─────────────────────────── Shared body ───────────────────────────

interface BodyProps {
  /**
   * Accepted for call-site compatibility, no longer read: liveness now comes
   * from the signed-in user's own worker-presence heartbeat, which is already
   * scoped to them.
   */
  orgId?: string;
  /** Hide the soft exit (onboarding controls its own continue chrome). */
  hideSkip?: boolean;
  /** Custom soft-exit label. Default "Skip for now". */
  skipLabel?: string;
  /** Soft exit (never blocks). */
  onSkip?: () => void;
  /** Called when the user resolves the sheet successfully (installed/done). */
  onDone?: () => void;
  /** Reports state transitions so a parent (onboarding) can react. */
  onStateChange?: (state: LinkComputerState) => void;
}

/**
 * Presentational + probe body shared by the sheet AND the onboarding step.
 * Runs the install + reachability probe on mount and exposes a re-check.
 */
export function LinkComputerBody({
  orgId,
  hideSkip,
  skipLabel = 'Skip for now',
  onSkip,
  onDone,
  onStateChange,
}: BodyProps) {
  // Local install probe. iOS won't answer canOpenURL unless the scheme is
  // declared in LSApplicationQueriesSchemes — a thrown/false result is
  // "unknown", never a hard "not installed". `undefined` means still probing.
  const [installed, setInstalled] = useState<boolean | null | undefined>(undefined);

  const runCheck = useCallback(async () => {
    setInstalled(undefined);
    try {
      setInstalled(await Linking.canOpenURL(COMPANION_URL_SCHEME));
    } catch {
      setInstalled(null);
    }
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // Liveness comes from the computer's own heartbeat in Convex (worker presence
  // + a staleness TTL), the same signal the rest of the app already trusts.
  // This used to call a backend health route that was never built: the 404 was
  // swallowed, so "reachable" was permanently false and the verdict silently
  // fell back to the local canOpenURL hint alone.
  const { computerOnline, presenceLoaded, degraded } = useFacebookJobStatus(true);

  const state = useMemo<LinkComputerState>(() => {
    // Presence is authoritative: a live heartbeat means the computer is linked,
    // and the weak local hint must never downgrade that. Wait for the first
    // presence result before trusting computerOnline=false.
    if (installed === undefined) return 'checking';
    if (!degraded && !presenceLoaded) return 'checking';
    if (!degraded && computerOnline) return 'installed';
    if (installed === true) return 'runtime_unreachable';
    if (installed === false) return 'not_installed';
    return 'unknown';
  }, [installed, computerOnline, presenceLoaded, degraded]);

  // Report transitions only. The parent may setState on every report, so firing
  // on each render would loop.
  const lastReported = useRef<LinkComputerState | null>(null);
  useEffect(() => {
    if (lastReported.current === state) return;
    lastReported.current = state;
    onStateChange?.(state);
  }, [state, onStateChange]);

  const copy = COPY[state];

  const onPrimary = useCallback(() => {
    if (state === 'not_installed') {
      Linking.openURL(GET_APP_URL).catch(() => {});
      return;
    }
    if (state === 'runtime_unreachable' || state === 'unknown') {
      runCheck();
      return;
    }
    // installed → done
    onDone?.();
  }, [state, runCheck, onDone]);

  return (
    <View>
      <View style={styles.bodyHeader}>
        <View style={[styles.iconCircle, { backgroundColor: copy.iconColor + '15' }]}>
          {state === 'checking' ? (
            <ActivityIndicator size="small" color={BRAND_PRIMARY} />
          ) : (
            <Icon name={copy.icon} size={22} color={copy.iconColor} />
          )}
        </View>
        <View style={styles.bodyHeaderText}>
          <Text style={styles.title}>{copy.title}</Text>
        </View>
      </View>

      <Text style={styles.body}>{copy.body}</Text>

      {state !== 'checking' ? (
        <TouchableOpacity style={styles.primaryButton} onPress={onPrimary} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>
            {state === 'installed' ? 'Done' : copy.primaryLabel || 'Done'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* A soft exit is ALWAYS present (sheet never blocks), unless the host
          owns its own continue chrome (onboarding). */}
      {!hideSkip && state !== 'checking' && state !== 'installed' ? (
        <TouchableOpacity style={styles.skipButton} onPress={onSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>{skipLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─────────────────────────── Sheet wrapper ───────────────────────────

interface SheetProps {
  visible: boolean;
  orgId?: string;
  onClose: () => void;
}

export default function LinkComputerSheet({ visible, orgId, onClose }: SheetProps) {
  return (
    <BaseModal visible={visible} onClose={onClose} position="bottom" containerStyle={styles.sheet}>
      <View style={styles.handle} />
      <View style={styles.sheetTopRow}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.closeCircle}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="close" size={18} color={TEXT_SECONDARY} />
        </TouchableOpacity>
      </View>

      <LinkComputerBody orgId={orgId} onSkip={onClose} onDone={onClose} />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: '#FFFFFF',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: HANDLE,
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bodyHeaderText: {
    flex: 1,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: TEXT,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: TEXT_SECONDARY,
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  skipText: {
    color: TEXT_SECONDARY,
    fontWeight: '600',
    fontSize: 14,
  },
});
