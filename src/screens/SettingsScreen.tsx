import React, { useContext } from 'react';
import { Alert, Linking, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  User, SlidersHorizontal, MapPin, Bell, Link2, ShieldCheck, Palette, Code2, LogOut,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';

type Card = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
};

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const authContext = useContext(AuthContext);

  const soon = (name: string) => Alert.alert(name, 'Coming soon.');

  const signOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => authContext?.signOut() },
    ]);
  };

  const cards: Card[] = [
    { key: 'account', label: 'Account & login', icon: <User size={22} color="#18181B" />, onPress: () => navigation.navigate('AccountSettings') },
    { key: 'personalization', label: 'Personalization', icon: <SlidersHorizontal size={22} color="#18181B" />, onPress: () => soon('Personalization') },
    { key: 'addresses', label: 'Addresses', icon: <MapPin size={22} color="#18181B" />, onPress: () => soon('Addresses') },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={22} color="#18181B" />, onPress: () => navigation.navigate('NotificationSettings') },
    { key: 'connections', label: 'Connections', icon: <Link2 size={22} color="#18181B" />, onPress: () => navigation.navigate('Connections') },
    { key: 'privacy', label: 'Data & privacy', icon: <ShieldCheck size={22} color="#18181B" />, onPress: () => soon('Data & privacy') },
    { key: 'appearance', label: 'Appearance', icon: <Palette size={22} color="#18181B" />, onPress: () => soon('Appearance') },
    { key: 'dev', label: 'Development mode', icon: <Code2 size={22} color="#18181B" />, onPress: () => navigation.navigate('AccountSettings') },
  ];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Settings</Text>

        <View style={styles.grid}>
          {cards.map(c => (
            <TouchableOpacity key={c.key} style={styles.card} onPress={c.onPress} activeOpacity={0.85}>
              <View style={styles.cardIcon}>{c.icon}</View>
              <Text style={styles.cardLabel}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.signOut} onPress={signOut} activeOpacity={0.7}>
          <LogOut size={20} color="#18181B" />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Anorha v0.1</Text>
        <View style={styles.links}>
          <TouchableOpacity onPress={() => Linking.openURL('https://inirha.com/terms').catch(() => undefined)}>
            <Text style={styles.link}>Terms and conditions</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL('https://inirha.com/licenses').catch(() => undefined)}>
            <Text style={styles.link}>Licenses</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },
  title: { fontSize: 34, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 18 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48.5%',
    height: 128,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardIcon: { width: 28, height: 28, alignItems: 'flex-start', justifyContent: 'center' },
  cardLabel: { fontSize: 17, color: '#18181B', fontFamily: 'Inter_700Bold' },

  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, marginTop: 16 },
  signOutText: { fontSize: 17, color: '#18181B', fontFamily: 'Inter_700Bold' },

  version: { textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 8 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 14 },
  link: { color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, textDecorationLine: 'underline' },
});

export default SettingsScreen;
