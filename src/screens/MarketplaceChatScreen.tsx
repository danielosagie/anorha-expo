import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';

/**
 * Marketplace Chat is not built yet. Rather than show a dead-end placeholder,
 * this screen immediately routes the user back to the home tab (Inventory).
 * When the chat feature is ready, replace this redirect with the real UI.
 */
const MarketplaceChatScreen = () => {
  const navigation = useNavigation<any>();

  useEffect(() => {
    // Send the user home. Reset so the (empty) chat screen can't be returned to
    // via the back gesture.
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'TabNavigator' }],
      })
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#5c9c00" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default MarketplaceChatScreen;
