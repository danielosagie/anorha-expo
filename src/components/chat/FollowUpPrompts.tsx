import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type FollowUpSuggestion = {
  label: string;
  prompt: string;
};

type Props = {
  suggestions: FollowUpSuggestion[];
  onPress: (prompt: string) => void;
  textColor?: string;
  borderColor?: string;
  iconColor?: string;
};

export const FollowUpPrompts = ({
  suggestions,
  onPress,
  textColor = '#27272A',
  borderColor = '#E5E7EB',
  iconColor = '#A1A1AA',
}: Props) => (
  <View style={styles.followUps} accessibilityLabel="Suggested follow-up questions">
    {suggestions.map((suggestion, index) => (
      <Pressable
        key={`${suggestion.label}-${index}`}
        style={({ pressed }) => [
          styles.followUpRow,
          { borderTopColor: borderColor },
          pressed && styles.followUpRowPressed,
        ]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => undefined);
          onPress(suggestion.prompt);
        }}
        accessibilityRole="button"
        accessibilityLabel={suggestion.label}
      >
        <Icon name="arrow-right" size={19} color={iconColor} />
        <Text style={[styles.followUpText, { color: textColor }]}>
          {suggestion.label}
        </Text>
      </Pressable>
    ))}
  </View>
);

const styles = StyleSheet.create({
  followUps: {
    marginTop: 8,
  },
  followUpRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  followUpRowPressed: {
    opacity: 0.58,
  },
  followUpText: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
});

export default FollowUpPrompts;
