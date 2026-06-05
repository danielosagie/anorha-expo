import React from 'react';
import { BRAND_PRIMARY } from '../../../design/tokens';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  queuedCount: number;
  isStreaming: boolean;
};

export const ConversationComposer = ({
  value,
  placeholder,
  onChangeText,
  onSend,
  queuedCount,
  isStreaming,
}: Props) => {
  return (
    <View style={styles.wrap}>
      {(isStreaming || queuedCount > 1) ? (
        <View style={styles.queueBanner}>
          <Icon name="progress-clock" size={13} color="#5D7E16" />
          <Text style={styles.queueText}>
            {isStreaming ? 'Assistant is streaming.' : 'Messages queued.'} {Math.max(queuedCount - 1, 0)} waiting.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#71717A"
          multiline
          value={value}
          onChangeText={onChangeText}
        />
        <TouchableOpacity
          style={[styles.sendButton, !value.trim() && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!value.trim()}
        >
          <Icon name="arrow-up" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  queueBanner: {
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(147,200,34,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueText: {
    color: '#5D7E16',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
  },
  card: {
    minHeight: 60,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    color: '#111827',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14,
    paddingTop: 2,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND_PRIMARY,
  },
  sendButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
});
