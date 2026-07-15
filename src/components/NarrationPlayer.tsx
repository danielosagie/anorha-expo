import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = {
  visible: boolean;
  playing: boolean;
  elapsedSeconds: number;
  speed: number;
  onTogglePlayback: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  onChangeSpeed: () => void;
  onClose: () => void;
};

function formatElapsed(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

type ControlProps = {
  icon: string;
  label: string;
  onPress: () => void;
};

const PlayerControl = ({ icon, label, onPress }: ControlProps) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    hitSlop={6}
    onPress={onPress}
    style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
  >
    <Icon name={icon} size={22} color="#18181B" />
  </Pressable>
);

export const NarrationPlayer = ({
  visible,
  playing,
  elapsedSeconds,
  speed,
  onTogglePlayback,
  onSeekBack,
  onSeekForward,
  onChangeSpeed,
  onClose,
}: Props) => {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[styles.positioner, { top: insets.top + 72 }]}>
      <BlurView intensity={84} tint="light" style={styles.player}>
        <View style={styles.playerFill}>
          <PlayerControl
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause reading' : 'Resume reading'}
            onPress={onTogglePlayback}
          />
          <Text style={styles.elapsed} accessibilityLabel={`${formatElapsed(elapsedSeconds)} elapsed`}>
            {formatElapsed(elapsedSeconds)}
          </Text>

          <View style={styles.flexSpacer} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reading speed ${speed} times. Change speed`}
            hitSlop={6}
            onPress={onChangeSpeed}
            style={({ pressed }) => [styles.speedControl, pressed && styles.controlPressed]}
          >
            <Text style={styles.speedText}>{Number.isInteger(speed) ? speed.toFixed(0) : speed}x</Text>
          </Pressable>
          <View style={styles.seekGroup}>
            <PlayerControl icon="rewind-15" label="Go back 15 seconds" onPress={onSeekBack} />
            <PlayerControl icon="fast-forward-15" label="Go forward 15 seconds" onPress={onSeekForward} />
          </View>
          <PlayerControl icon="close" label="Close reader" onPress={onClose} />
        </View>
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  positioner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10020,
  },
  player: {
    height: 74,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(24,24,27,0.10)',
    ...Platform.select({
      ios: {
        shadowColor: '#18181B',
        shadowOffset: { width: 0, height: 7 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  playerFill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(250,250,248,0.88)' : 'rgba(250,250,248,0.98)',
  },
  control: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlPressed: {
    backgroundColor: 'rgba(24,24,27,0.07)',
    opacity: 0.72,
  },
  elapsed: {
    minWidth: 50,
    marginLeft: 1,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  flexSpacer: {
    flex: 1,
    minWidth: 2,
  },
  speedControl: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: {
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  seekGroup: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: 7,
  },
});
