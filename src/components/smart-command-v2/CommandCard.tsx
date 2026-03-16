import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SMART_COMMAND_THEMES, SmartCommandCardKind } from './types';

type Props = {
  kind: SmartCommandCardKind;
  title: string;
  subtitle?: string;
  buttonLabel?: string;
  onButtonPress?: () => void;
  children?: React.ReactNode;
  style?: ViewStyle;
};

const CommandCard: React.FC<Props> = ({
  kind,
  title,
  subtitle,
  buttonLabel,
  onButtonPress,
  children,
  style,
}) => {
  const theme = SMART_COMMAND_THEMES[kind];

  return (
    <View style={[styles.card, { backgroundColor: theme.background }, style]}>
      <View style={styles.headerRow}>
        <View style={[styles.modeDot, { backgroundColor: theme.accent }]}>
          <Icon name="chat-processing-outline" size={13} color={kind === 'discuss' || kind === 'actions' ? '#111827' : '#1E3AFC'} />
        </View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      </View>

      {!!subtitle && (
        <Text style={[styles.subtitle, { color: theme.mutedText }]} numberOfLines={3}>
          {subtitle}
        </Text>
      )}

      {children}

      {!!buttonLabel && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.buttonBackground }]}
          onPress={onButtonPress}
        >
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>{buttonLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeDot: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default CommandCard;
