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
import React, { useCallback, useEffect, useState } from 'react';
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
import { ensureSupabaseJwt } from '../lib/supabase';
import { BRAND_PRIMARY } from '../design/tokens';

const SSSYNC_API_BASE_URL = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/$/, '');

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
  const [state, setState] = useState<LinkComputerState>('checking');

  const runCheck = useCallback(async () => {
    setState('checking');
    onStateChange?.('checking');

    // 1. Local install probe. iOS won't answer canOpenURL unless the scheme is
    //    declared in LSApplicationQueriesSchemes — a thrown/false result is
    //    "unknown", never a hard "not installed".
    let installed: boolean | null = null;
    try {
      installed = await Linking.canOpenURL(COMPANION_URL_SCHEME);
    } catch {
      installed = null;
    }

    // 2. Reachability via the backend health check. Guarded by an 8s timeout so a
    //    hung request can never leave the sheet stuck on 'checking' (RN fetch has
    //    no default timeout) — on abort we fall through to a real state below.
    let reachable = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(
        `${SSSYNC_API_BASE_URL}/api/platform-execution/ponder/health${
          orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
        }`,
        { headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: ctrl.signal },
      );
      if (res.ok) {
        const d = await res.json();
        reachable = !!d?.reachable;
      }
    } catch {
      // Network error OR the timeout abort — treat as not reachable.
      reachable = false;
    } finally {
      clearTimeout(timer);
    }

    // Backend reachability is authoritative: actually reaching the computer's
    // runtime means it's linked. canOpenURL is only a weak local hint (iOS returns
    // false/throws unless the scheme is declared) and must NOT downgrade a
    // confirmed-reachable computer to not_installed/unknown.
    let next: LinkComputerState;
    if (reachable) next = 'installed';
    else if (installed === true) next = 'runtime_unreachable';
    else if (installed === false) next = 'not_installed';
    else next = 'unknown';

    setState(next);
    onStateChange?.(next);
  }, [orgId, onStateChange]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

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
