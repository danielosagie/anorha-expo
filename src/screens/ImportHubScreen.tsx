import React from 'react';
import { SafeAreaView, Text } from 'react-native';

// Import Inbox hub — the single wrapper around importing (see docs/import-hub-redesign.md).
// Stub registered ahead of implementation so dependent screens can navigate to it.
export default function ImportHubScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Text>Import inbox</Text>
    </SafeAreaView>
  );
}
