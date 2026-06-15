import React from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PageHeader from '../components/ui/PageHeader';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F7F4',
  },
  section: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  heading: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
    marginTop: 20,
    marginBottom: 8,
  },
  headingFirst: {
    marginTop: 0,
  },
  body: {
    fontSize: 14,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
    marginBottom: 12,
  },
  list: {
    marginBottom: 12,
    paddingLeft: 4,
  },
  listItem: {
    fontSize: 14,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
    marginBottom: 6,
  },
  appName: {
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
});

export default function DeleteAccountInfoScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Data & deletion" onBack={() => navigation.goBack()} />

        <Text style={styles.section}>Account & data deletion</Text>
        <View style={styles.card}>
          <Text style={[styles.heading, styles.headingFirst]}>App / developer</Text>
          <Text style={styles.body}>
            This page describes how to request deletion of your account and data for <Text style={styles.appName}>Anorha</Text>.
          </Text>

          <Text style={styles.heading}>How to request account and data deletion</Text>
          <Text style={styles.body}>In the app:</Text>
          <View style={styles.list}>
            <Text style={styles.listItem}>• Open <Text style={styles.appName}>Anorha</Text> → Profile → Delete Account</Text>
            <Text style={styles.listItem}>• Follow the steps (confirm your business name and reason)</Text>
            <Text style={styles.listItem}>• Your account and associated data will be deleted</Text>
          </View>
          <Text style={styles.body}>
            You can also contact support with the subject &quot;Delete my account&quot; and the email address of your account.
          </Text>

          <Text style={styles.heading}>What we delete</Text>
          <Text style={styles.body}>
            Account and profile, organization memberships, platform connections, products and listings data, usage and activity data tied to your account, and other user data we hold for your account.
          </Text>

          <Text style={styles.heading}>What we may keep (and for how long)</Text>
          <Text style={styles.body}>
            Data we are required to keep by law (e.g. tax or invoice records) for the period required by law. Backups or logs may retain your data for a short period (e.g. up to 90 days) before being purged.
          </Text>

          <Text style={styles.heading}>Timing</Text>
          <Text style={styles.body}>
            Deletion is processed when you confirm in the app (or when we process your support request).
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
