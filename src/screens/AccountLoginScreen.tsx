// Account & login — focused Shop-app-style account page replacing the legacy
// AccountSettings mega-screen. One white card with Email / Phone / Name rows,
// a passkey promo card, and a red-outlined "Log out of all devices" button.

import React, { useContext, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/clerk-expo';
import { ChevronRight, Cloud, ScanFace, Zap } from 'lucide-react-native';
import { PageHeader } from '../components/ui/PageHeader';
import { AuthContext } from '../context/AuthContext';

/** Pull the friendliest message out of a Clerk API error (or any thrown value). */
const clerkErrorMessage = (err: unknown): string => {
  const anyErr = err as any;
  return (
    anyErr?.errors?.[0]?.longMessage ||
    anyErr?.errors?.[0]?.message ||
    anyErr?.message ||
    'Something went wrong. Please try again.'
  );
};

const AccountLoginScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const authContext = useContext(AuthContext);

  // Name modal state
  const [nameOpen, setNameOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Phone modal state
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  // Busy flags for the one-shot actions
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  if (!user) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#93C822" />
      </View>
    );
  }

  const email = user.primaryEmailAddress?.emailAddress || '—';
  const phone = user.primaryPhoneNumber?.phoneNumber;

  const openNameModal = () => {
    setFirstName(user.firstName || '');
    setLastName(user.lastName || '');
    setNameOpen(true);
  };

  const saveName = async () => {
    setSavingName(true);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      setNameOpen(false);
    } catch (err) {
      Alert.alert('Could not update name', clerkErrorMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const openPhoneModal = () => {
    setPhoneInput('');
    setPhoneOpen(true);
  };

  const savePhone = async () => {
    const value = phoneInput.trim();
    if (!value) {
      Alert.alert('Phone', 'Enter a phone number first.');
      return;
    }
    setSavingPhone(true);
    try {
      await user.createPhoneNumber({ phoneNumber: value });
      setPhoneOpen(false);
      Alert.alert('Phone added', 'Check your messages: it will be verified by SMS.');
    } catch (err) {
      Alert.alert('Phone', clerkErrorMessage(err));
    } finally {
      setSavingPhone(false);
    }
  };

  const addPasskey = async () => {
    setAddingPasskey(true);
    try {
      await user.createPasskey();
      Alert.alert('Passkey added', 'You can now sign in with Face ID or your device lock.');
    } catch (err) {
      Alert.alert('Passkey', clerkErrorMessage(err));
    } finally {
      setAddingPasskey(false);
    }
  };

  const logOutAllDevices = () => {
    Alert.alert(
      'Log out of all devices?',
      'This signs you out everywhere, including this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOutAll(true);
            try {
              const sessions = await user.getSessions();
              await Promise.all(sessions.map((s) => s.revoke().catch(() => undefined)));
              await authContext?.signOut();
            } catch (err) {
              Alert.alert('Could not log out everywhere', clerkErrorMessage(err));
            } finally {
              setLoggingOutAll(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 18,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Account & login" onBack={() => navigation.goBack()} />

        {/* Card 1 — Email / Phone / Name */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{email}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={openPhoneModal}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Phone</Text>
              <Text style={styles.rowValue}>{phone || 'Add phone'}</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={openNameModal}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{user.fullName || 'Add name'}</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
        </View>

        {/* Passkey promo card 
        <View style={styles.passkeyCard}>
          <Text style={styles.passkeyTitle}>Sign in faster with a passkey</Text>
          <View style={styles.benefitRow}>
            <Zap size={16} color="#71717A" />
            <Text style={styles.benefitText}>One-tap sign in with Face ID or your device lock</Text>
          </View>
          <View style={styles.benefitRow}>
            <Cloud size={16} color="#71717A" />
            <Text style={styles.benefitText}>Synced securely across your devices, nothing to remember</Text>
          </View>
          <TouchableOpacity
            style={styles.passkeyButton}
            activeOpacity={0.85}
            onPress={addPasskey}
            disabled={addingPasskey}
          >
            {addingPasskey ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <ScanFace size={18} color="#FFFFFF" />
                <Text style={styles.passkeyButtonText}>Add passkey</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        */}

        {/* Log out of all devices */}
        <TouchableOpacity
          style={styles.logoutAllButton}
          activeOpacity={0.7}
          onPress={logOutAllDevices}
          disabled={loggingOutAll}
        >
          {loggingOutAll ? (
            <ActivityIndicator size="small" color="#DC2626" />
          ) : (
            <Text style={styles.logoutAllText}>Log out of all devices</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Name edit modal */}
      <Modal visible={nameOpen} transparent animationType="fade" onRequestClose={() => setNameOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
            />
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="words"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                activeOpacity={0.7}
                onPress={() => setNameOpen(false)}
                disabled={savingName}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                activeOpacity={0.85}
                onPress={saveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Phone edit modal */}
      <Modal visible={phoneOpen} transparent animationType="fade" onRequestClose={() => setPhoneOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Phone number</Text>
            {phone ? <Text style={styles.modalCurrent}>Current: {phone}</Text> : null}
            <Text style={styles.modalNote}>Phone changes are verified by SMS</Text>
            <TextInput
              style={styles.input}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="+1 555 555 5555"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                activeOpacity={0.7}
                onPress={() => setPhoneOpen(false)}
                disabled={savingPhone}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                activeOpacity={0.85}
                onPress={savePhone}
                disabled={savingPhone}
              >
                {savingPhone ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },
  loadingRoot: {
    flex: 1,
    backgroundColor: '#F6F7F4',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Card 1 — identity rows
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#9CA3AF',
    marginBottom: 2,
  },
  rowValue: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  divider: { height: 1, backgroundColor: '#F1F1EE' },

  // Passkey promo card
  passkeyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    padding: 16,
    marginBottom: 24,
  },
  passkeyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    marginBottom: 10,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  benefitText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
  },
  passkeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#18181B',
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 6,
  },
  passkeyButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },

  // Log out of all devices
  logoutAllButton: {
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  logoutAllText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#DC2626',
  },

  // Centered modal pattern
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    marginBottom: 12,
  },
  modalCurrent: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
    marginBottom: 4,
  },
  modalNote: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ECEBE6',
    borderRadius: 14,
    backgroundColor: '#FAFAF8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: '#18181B',
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: { backgroundColor: '#F1F1EE' },
  cancelButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  saveButton: { backgroundColor: '#93C822' },
  saveButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
});

export default AccountLoginScreen;
