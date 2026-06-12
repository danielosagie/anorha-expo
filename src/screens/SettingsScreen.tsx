// Profile tab — identity header (avatar / name / org), live Connected Platforms
// preview, then the settings grid. Every card goes somewhere REAL.

import React, { useContext, useEffect, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/clerk-expo';
import * as Clipboard from 'expo-clipboard';
import {
  User, Users, Bell, Handshake, ShieldCheck, CreditCard, LogOut, ChevronRight, Plus, Code2,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import PlatformAvatar from '../components/PlatformAvatar';

type Card = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
};

const statusOf = (raw?: string): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (s.includes('active') || s.includes('connect') || s === 'ok' || s === 'live') return { label: 'Connected', color: '#43631A' };
  if (s.includes('error') || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Needs reconnect', color: '#DC2626' };
  if (s.includes('sync')) return { label: 'Syncing…', color: '#A2611A' };
  return { label: raw || 'Connected', color: '#71717A' };
};

/** "myshop.myshopify.com" → "myshop"; fall back to the platform name. */
const shopLabel = (c: any): string => {
  const name = String(c.DisplayName || c.PlatformType || 'Platform');
  return name.replace(/\.myshopify\.com$/i, '');
};

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const authContext = useContext(AuthContext);
  const { user } = useUser();
  const { currentOrg } = useOrg();
  const { liveConnections, refresh } = usePlatformConnections();

  useEffect(() => {
    refresh?.();
  }, [refresh]);

  const displayName = user?.fullName || user?.firstName || 'Your account';
  const orgLine = currentOrg?.name || user?.primaryEmailAddress?.emailAddress || '';
  const platformPreview = (liveConnections || []).slice(0, 4);
  // Dev tools (dev builds only): the agent bundle + the raw auth token.
  const openDevTools = () => {
    Alert.alert('Developer', 'Tools for local development.', [
      {
        text: 'Copy dev bundle',
        onPress: async () => {
          try {
            const token = await ensureSupabaseJwt();
            const r = await fetch(`${API_BASE_URL}/api/dev/agent-bundle`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) throw new Error(`${r.status}`);
            const bundle = await r.json();
            await Clipboard.setStringAsync(
              JSON.stringify({ apiBaseUrl: API_BASE_URL, supabaseJwt: token, ...bundle }, null, 2),
            );
            Alert.alert('Copied', 'Developer bundle copied to clipboard.');
          } catch (e: any) {
            Alert.alert('Dev bundle error', e?.message || 'Failed to fetch the dev bundle.');
          }
        },
      },
      {
        text: 'Copy auth token',
        onPress: async () => {
          try {
            const token = await ensureSupabaseJwt();
            if (!token) throw new Error('No active token');
            await Clipboard.setStringAsync(token);
            Alert.alert('Copied', 'Auth token copied to clipboard.');
          } catch (e: any) {
            Alert.alert('Token error', e?.message || 'Failed to get the auth token.');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const signOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => authContext?.signOut() },
    ]);
  };

  // Every card goes somewhere REAL — no "coming soon" dead ends.
  const cards: Card[] = [
    { key: 'account', label: 'Account & login', icon: <User size={22} color="#18181B" />, onPress: () => navigation.navigate('AccountLogin') },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={22} color="#18181B" />, onPress: () => navigation.navigate('NotificationSettings') },
    { key: 'team', label: 'Team', icon: <Users size={22} color="#18181B" />, onPress: () => navigation.navigate('Team') },
    { key: 'partners', label: 'Partners', icon: <Handshake size={22} color="#18181B" />, onPress: () => navigation.navigate('Partners') },
    { key: 'billing', label: 'Billing', icon: <CreditCard size={22} color="#18181B" />, onPress: () => navigation.navigate('Billing') },
    { key: 'privacy', label: 'Privacy & Security', icon: <ShieldCheck size={22} color="#18181B" />, onPress: () => navigation.navigate('PrivacySecurity') },
    // Dev builds only: agent bundle + auth token helpers.
    ...(__DEV__
      ? [{ key: 'dev', label: 'Developer', icon: <Code2 size={22} color="#18181B" />, onPress: openDevTools } as Card]
      : []),
  ];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity header — avatar, name, org */}
        <TouchableOpacity
          style={styles.identityRow}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('AccountLogin')}
        >
          {user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{(displayName[0] || 'A').toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {!!orgLine && <Text style={styles.org} numberOfLines={1}>{orgLine}</Text>}
          </View>
        </TouchableOpacity>

        {/* Integrations preview — tap a row for its import overview; full
            management (refresh/remove/connect) lives on the Connections page. */}
        <TouchableOpacity
          style={styles.sectionRow}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Connections')}
        >
          <Text style={styles.sectionTitle}>Integrations</Text>
          <View style={styles.sectionChevron}>
            <ChevronRight size={16} color="#71717A" />
          </View>
        </TouchableOpacity>
        <View style={styles.platformCard}>
          {platformPreview.length === 0 ? (
            <TouchableOpacity
              style={styles.platformEmptyRow}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Connections')}
            >
              <View style={styles.platformEmptyIcon}>
                <Plus size={18} color="#43631A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.platformName}>Connect your first platform</Text>
                <Text style={styles.platformEmptySub}>Shopify, Square, eBay, Amazon and more</Text>
              </View>
              <ChevronRight size={20} color="#D4D4D8" />
            </TouchableOpacity>
          ) : (
            platformPreview.map((c: any, i: number) => {
              const st = statusOf(c.Status);
              return (
                <TouchableOpacity
                  key={c.Id}
                  style={[styles.platformRow, i > 0 && styles.platformRowBorder]}
                  activeOpacity={0.7}
                  onPress={() =>
                    navigation.navigate('ImportOverview', {
                      connectionId: c.Id,
                      platformName: c.PlatformType,
                    })
                  }
                >
                  <PlatformAvatar platformType={(c.PlatformType || '').toLowerCase()} size="medium" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.platformName} numberOfLines={1}>{shopLabel(c)}</Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: st.color }]} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#D4D4D8" />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.gridLabel}>Settings</Text>
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

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { backgroundColor: '#93C822', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 24, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
  name: { fontSize: 24, color: '#18181B', fontFamily: 'Inter_700Bold' },
  org: { fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 1 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginLeft: 4 },
  sectionTitle: { fontSize: 17, color: '#18181B', fontFamily: 'Inter_700Bold' },
  sectionChevron: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#ECEBE6',
    alignItems: 'center', justifyContent: 'center',
  },
  platformCard: {
    backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 16, marginBottom: 26,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  platformRowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  platformName: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  platformEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  platformEmptyIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(147,200,34,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  platformEmptySub: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 },

  gridLabel: { fontSize: 17, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 12, marginLeft: 4 },
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
