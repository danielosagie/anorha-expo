import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SMART_COMMAND_THEMES, SmartCommandCardKind } from './types';

type Props = {
  kind?: SmartCommandCardKind;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
};

const SmartCommandShell: React.FC<Props> = ({
  kind = 'ask',
  title = 'Ask',
  subtitle,
  children,
}) => {
  const theme = SMART_COMMAND_THEMES[kind];

  return (
    <View style={[styles.shell, { backgroundColor: theme.background }]}> 
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {!!subtitle && <Text style={[styles.subtitle, { color: theme.mutedText }]}>{subtitle}</Text>}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  shell: {
    borderRadius: 20,
    padding: 12,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default SmartCommandShell;
