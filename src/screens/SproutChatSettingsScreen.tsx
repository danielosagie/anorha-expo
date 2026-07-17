import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Brain, ListTree, MessagesSquare, Sparkles } from 'lucide-react-native';
import { PageHeader } from '../components/ui/PageHeader';
import {
  type ChatPreferences,
  setChatPreference,
  useChatPreferences,
} from '../features/liquidationConversation/chatPreferences';

type ToggleRowProps = {
  title: string;
  description: string;
  value: boolean;
  icon: React.ReactNode;
  divided?: boolean;
  onChange: (value: boolean) => void;
};

const ToggleRow = ({ title, description, value, icon, divided, onChange }: ToggleRowProps) => (
  <Pressable
    style={({ pressed }) => [styles.optionRow, divided && styles.divider, pressed && styles.pressed]}
    onPress={() => onChange(!value)}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
  >
    <View style={styles.iconWrap}>{icon}</View>
    <View style={styles.optionCopy}>
      <Text style={styles.optionTitle}>{title}</Text>
      <Text style={styles.optionDescription}>{description}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: '#D9DBD5', true: '#93C822' }}
      thumbColor="#FCFDF9"
    />
  </Pressable>
);

const SproutChatSettingsScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const preferences = useChatPreferences();

  const update = useCallback((key: keyof ChatPreferences, value: boolean) => {
    Haptics.selectionAsync().catch(() => undefined);
    void setChatPreference(key, value).catch(() => {
      Alert.alert('Could not save', 'Try changing that setting again.');
    });
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 18,
          paddingBottom: insets.bottom + 80,
        }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Sprout chat" onBack={() => navigation.goBack()} />

        <Text style={styles.sectionLabel}>Context</Text>
        <View style={styles.listSurface}>
          <ToggleRow
            title="Shared campaign memory"
            description="Carry saved decisions and preferences into new chats."
            value={preferences.sharedMemory}
            onChange={value => update('sharedMemory', value)}
            icon={<Brain size={21} color="#314E0E" />}
          />
        </View>

        <Text style={styles.sectionLabel}>Responses</Text>
        <View style={styles.listSurface}>
          <ToggleRow
            title="Expanded activity"
            description="Open Sprout's activity details automatically."
            value={preferences.expandedActivity}
            onChange={value => update('expandedActivity', value)}
            icon={<ListTree size={21} color="#314E0E" />}
          />
          <ToggleRow
            divided
            title="Suggested follow-ups"
            description="Show useful next questions after the latest response."
            value={preferences.suggestedFollowUps}
            onChange={value => update('suggestedFollowUps', value)}
            icon={<Sparkles size={21} color="#314E0E" />}
          />
        </View>

        <View style={styles.explainer}>
          <MessagesSquare size={20} color="#5C6B4B" />
          <Text style={styles.explainerText}>
            Each chat keeps its own history. Shared memory carries only durable campaign decisions and preferences between chats.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F2' },
  sectionLabel: {
    marginLeft: 4,
    marginBottom: 9,
    color: '#6F7568',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
  listSurface: {
    marginBottom: 24,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E6E8E1',
    borderRadius: 20,
    backgroundColor: '#FCFDF9',
  },
  optionRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E6E8E1' },
  pressed: { opacity: 0.72 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDF5DC',
  },
  optionCopy: { flex: 1, paddingRight: 4 },
  optionTitle: { color: '#1A1C18', fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  optionDescription: {
    marginTop: 3,
    color: '#747A6E',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    paddingHorizontal: 5,
  },
  explainerText: {
    flex: 1,
    color: '#697061',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
});

export default SproutChatSettingsScreen;
