// Privacy & Security — data policy summary plus the REAL delete-account flow
// (type-to-confirm org name + reason → DELETE /api/users/me → sign out), which
// previously only existed buried inside the old account mega-screen.

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
import { useAuth } from '@clerk/expo';
import { ChevronRight, FileText, ShieldCheck, Trash2 } from 'lucide-react-native';
import { PageHeader } from '../components/ui/PageHeader';
import { AuthContext } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { API_BASE_URL } from '../config/env';

const PrivacySecurityScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const authContext = useContext(AuthContext);
  const { currentOrg } = useOrg();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  const businessName = currentOrg?.name || '';

  const confirmDelete = async () => {
    if (businessName && confirmName.trim().toLowerCase() !== businessName.toLowerCase()) {
      Alert.alert('Name mismatch', 'Type your business name exactly as shown.');
      return;
    }
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Tell us briefly why you are leaving.');
      return;
    }
    setDeleting(true);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert('Error', 'Please log in again to delete your account.');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/api/users/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (response.ok) {
        setDeleteOpen(false);
        Alert.alert('Account deleted', 'Your account has been permanently deleted.', [
          { text: 'OK', onPress: () => authContext?.signOut() },
        ]);
      } else {
        const data = await response.json().catch(() => ({}));
        Alert.alert('Error', data.message || 'Failed to delete account. Please contact support.');
      }
    } catch {
      Alert.alert('Error', 'An error occurred while deleting your account. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader title="Privacy & Security" onBack={() => navigation.goBack()} />

        <Text style={styles.section}>Your data</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(147,200,34,0.16)' }]}>
              <ShieldCheck size={20} color="#43631A" />
            </View>
            <Text style={styles.infoText}>
              Your listings, connections and usage data belong to your org. Deleting your
              account removes them — permanently.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.linkRow, styles.rowBorder]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('DeleteAccountInfo')}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#F1F1EE' }]}>
              <FileText size={20} color="#18181B" />
            </View>
            <Text style={styles.linkText}>Full data & deletion policy</Text>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.section, { marginTop: 26 }]}>Danger zone</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <TouchableOpacity style={styles.linkRow} activeOpacity={0.7} onPress={() => setDeleteOpen(true)}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(220,38,38,0.10)' }]}>
              <Trash2 size={20} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerTitle}>Delete account</Text>
              <Text style={styles.dangerSub}>Permanent — removes your account, listings and connections</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Type-to-confirm delete modal */}
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete account?</Text>
            <Text style={styles.modalBody}>
              Permanently deletes your account, listings and connections. This can't be undone.
            </Text>
            {!!businessName && (
              <>
                <Text style={styles.modalLabel}>
                  Type your business name to confirm: <Text style={styles.modalStrong}>{businessName}</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={confirmName}
                  onChangeText={setConfirmName}
                  placeholder={businessName}
                  placeholderTextColor="#C7C7CC"
                  autoCapitalize="none"
                />
              </>
            )}
            <Text style={styles.modalLabel}>Why are you leaving?</Text>
            <TextInput
              style={[styles.input, { minHeight: 64 }]}
              value={reason}
              onChangeText={setReason}
              placeholder="A sentence is plenty"
              placeholderTextColor="#C7C7CC"
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteOpen(false)} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
                onPress={confirmDelete}
                disabled={deleting}
                activeOpacity={0.8}
              >
                {deleting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.deleteText}>Delete forever</Text>}
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
  section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  dangerCard: { borderColor: 'rgba(220,38,38,0.25)' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16 },
  infoText: { flex: 1, fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 21 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  linkText: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  dangerTitle: { fontSize: 16, color: '#DC2626', fontFamily: 'Inter_600SemiBold' },
  dangerSub: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20 },
  modalTitle: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 8 },
  modalBody: { fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  modalLabel: { fontSize: 13, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 6, marginTop: 6 },
  modalStrong: { fontFamily: 'Inter_700Bold' },
  input: {
    borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8', marginBottom: 8,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#F1F1EE' },
  cancelText: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  deleteBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#DC2626' },
  deleteText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
});

export default PrivacySecurityScreen;
