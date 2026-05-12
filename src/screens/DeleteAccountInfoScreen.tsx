import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import BackButton from '../components/BackButton';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 20,
    marginBottom: 8,
  },
  headingFirst: {
    marginTop: 0,
  },
  body: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 12,
  },
  list: {
    marginBottom: 12,
    paddingLeft: 4,
  },
  listItem: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 6,
  },
  appName: {
    fontWeight: '600',
    color: '#111827',
  },
});

export default function DeleteAccountInfoScreen() {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>Account & data deletion</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
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
      </ScrollView>
    </SafeAreaView>
  );
}
