import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useUser } from '@clerk/expo';
import { StandaloneGlobalSproutChat } from '../components/sprout/QuickChatSheet';

// The full Sprout surface, reached from the dock's expand button. It mounts its own
// conversation against the same thread — the draft and the transcript are persisted per
// thread, so nothing is carried across in memory. There used to be a second, teleported
// implementation of this screen whose only job was to keep the dock's conversation mounted
// while it escaped a native Modal; the dock has no Modal any more, so neither exists.
export default function GlobalSproutChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useUser();
  const firstName =
    route.params?.firstName ||
    user?.firstName ||
    user?.fullName?.trim()?.split(/\s+/)[0] ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'there';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F8F4" />
      <StandaloneGlobalSproutChat
        firstName={firstName}
        campaignId={route.params?.campaignId}
        suggestedQuestions={route.params?.suggestedQuestions}
        placeholder={route.params?.placeholder}
        emptyHint={route.params?.emptyHint}
        onClose={() => navigation.goBack()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F8F4',
  },
});
