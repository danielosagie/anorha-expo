import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const MarketplaceChatScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Marketplace Chat</Text>
      <Text style={styles.subtitle}>Coming soon. Chat with buyers and other sellers here.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
});

export default MarketplaceChatScreen;



