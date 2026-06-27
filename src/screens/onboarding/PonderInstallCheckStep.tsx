import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinkComputerBody, LinkComputerState } from '../../components/LinkComputerSheet';
import { BRAND_PRIMARY } from '../../design/tokens';

interface Props {
  orgId?: string;
  /** Onboarding is never blocked by this step. */
  onContinue?: () => void;
}

/**
 * Onboarding step: link the user's computer so listings post automatically.
 * Renders the SHARED <LinkComputerBody> (same probe + copy as the in-app
 * "Link your computer" bottom sheet, so wording never drifts), then keeps its
 * own continue chrome. It NEVER blocks progression — an indeterminate result
 * still lets the user move on.
 */
export default function PonderInstallCheckStep({ orgId, onContinue }: Props) {
  const [state, setState] = useState<LinkComputerState>('checking');

  const onStateChange = useCallback((s: LinkComputerState) => setState(s), []);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        {/* hideSkip: onboarding owns its own Continue chrome below. */}
        <LinkComputerBody orgId={orgId} hideSkip onStateChange={onStateChange} onDone={onContinue} />
      </View>

      <TouchableOpacity
        style={styles.continue}
        onPress={onContinue}
        disabled={state === 'checking'}
        activeOpacity={0.85}
      >
        <Text style={styles.continueText}>
          {state === 'installed' ? 'Continue' : 'Continue anyway'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  body: { marginBottom: 8 },
  continue: {
    backgroundColor: BRAND_PRIMARY,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  continueText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
