import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { ensureSupabaseJwt } from '../../lib/supabase';

const SSSYNC_API_BASE_URL = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/$/, '');

// Confirm the exact scheme from the Ponder repo when available.
const PONDER_URL_SCHEME = 'ponder://';

type CheckState =
  | 'checking'
  | 'installed'
  | 'not_installed'
  | 'runtime_unreachable'
  | 'unknown';

interface Props {
  orgId?: string;
  /** Onboarding is never blocked by this step. */
  onContinue?: () => void;
}

/**
 * Onboarding scaffold: checks whether the Ponder browser-automation app is
 * installed locally and whether its runtime (Convex job pipeline) is
 * reachable. Standalone + drop-in — wire into the onboarding navigator when
 * the flow architecture is settled. It NEVER blocks progression: an
 * indeterminate result resolves to "unknown" and still lets the user move on.
 */
export default function PonderInstallCheckStep({ orgId, onContinue }: Props) {
  const [state, setState] = useState<CheckState>('checking');

  const runCheck = useCallback(async () => {
    setState('checking');

    // 1. Local install probe. iOS won't answer canOpenURL unless the scheme
    //    is declared in LSApplicationQueriesSchemes — treat a thrown/false
    //    result as "unknown", never as a hard "not installed".
    let installed: boolean | null = null;
    try {
      installed = await Linking.canOpenURL(PONDER_URL_SCHEME);
    } catch {
      installed = null;
    }

    // 2. Runtime reachability via the backend health scaffold.
    let reachable = false;
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(
        `${SSSYNC_API_BASE_URL}/api/platform-execution/ponder/health${
          orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
        }`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        reachable = !!d?.reachable;
      }
    } catch {
      reachable = false;
    }

    if (installed === true && reachable) setState('installed');
    else if (installed === true && !reachable) setState('runtime_unreachable');
    else if (installed === false) setState('not_installed');
    else setState('unknown');
  }, [orgId]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const copy: Record<CheckState, { title: string; body: string }> = {
    checking: { title: 'Checking automation setup…', body: 'One moment.' },
    installed: {
      title: 'Ponder is ready',
      body: 'Browser automation is installed and its runtime is reachable.',
    },
    not_installed: {
      title: 'Ponder not detected',
      body: 'Install the Ponder companion app to let Anora act on marketplaces that need browser automation. You can do this later.',
    },
    runtime_unreachable: {
      title: 'Ponder installed, runtime offline',
      body: 'Ponder is installed but its runtime is not reachable yet. Anora will queue actions until it comes online.',
    },
    unknown: {
      title: 'Automation status unknown',
      body: "We couldn't confirm Ponder's status on this device. That's fine — you can continue and set it up later.",
    },
  };

  const { title, body } = copy[state];

  return (
    <View style={styles.container}>
      {state === 'checking' ? (
        <ActivityIndicator size="large" color="#5c9c00" />
      ) : (
        <Text style={styles.badge}>
          {state === 'installed' ? '✅' : state === 'unknown' ? 'ℹ️' : '⚠️'}
        </Text>
      )}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      <View style={styles.actions}>
        {state !== 'checking' && state !== 'installed' ? (
          <TouchableOpacity style={styles.secondary} onPress={runCheck}>
            <Text style={styles.secondaryText}>Re-check</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.primary}
          onPress={onContinue}
          disabled={state === 'checking'}
        >
          <Text style={styles.primaryText}>
            {state === 'installed' ? 'Continue' : 'Continue anyway'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  badge: { fontSize: 40, marginBottom: 12 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginTop: 12,
  },
  body: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  actions: { flexDirection: 'row', marginTop: 28, gap: 12 },
  primary: {
    backgroundColor: '#5c9c00',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryText: { color: '#FFF', fontWeight: '600', fontSize: 15 },
  secondary: {
    backgroundColor: '#EEE',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryText: { color: '#333', fontWeight: '600', fontSize: 15 },
});
