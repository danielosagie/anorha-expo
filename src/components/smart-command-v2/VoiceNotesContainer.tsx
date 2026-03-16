import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  children?: React.ReactNode;
};

const VoiceNotesContainer: React.FC<Props> = ({ children }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice notes</Text>
      <Text style={styles.subtitle}>Speak your thoughts, ideas, or reminders.</Text>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 6,
  },
  title: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 12,
  },
});

export default VoiceNotesContainer;
