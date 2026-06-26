import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Picker } from '@react-native-picker/picker';
import { useAuth, useUser } from '@clerk/expo';
import { useTheme } from '../context/ThemeContext';

const API_BASE_RAW = API_BASE_URL;
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

const ISSUE_TYPES = ['Billing', 'Subscription', 'AI Credits', 'Other'];

export default function BillingSupportScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();

  const context = route?.params?.context || {};

  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0]);
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [contactEmail, setContactEmail] = useState<string>('');
  const [screenshot, setScreenshot] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!contactEmail && clerkUser?.primaryEmailAddress?.emailAddress) {
      setContactEmail(clerkUser.primaryEmailAddress.emailAddress);
    }
  }, [clerkUser, contactEmail]);

  const metadata = useMemo(() => {
    return {
      planName: context?.planName,
      subscriptionStatus: context?.subscriptionStatus,
      aiAllowanceCents: context?.aiAllowanceCents,
      aiUsedCents: context?.aiUsedCents,
      appVersion: Application.nativeApplicationVersion || Constants.expoConfig?.version || null,
      appBuild: Application.nativeBuildVersion || null,
      appId: Application.applicationId || null,
      appOwnership: Constants.appOwnership || null,
      platform: Platform.OS,
      platformVersion: Platform.Version,
      device: {
        model: Device.modelName || null,
        manufacturer: Device.manufacturer || null,
        osName: Device.osName || null,
        osVersion: Device.osVersion || null,
      },
    };
  }, [context]);

  const pickScreenshot = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need photo library access to attach a screenshot.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });

    if (!result.canceled && result.assets?.[0]) {
      setScreenshot(result.assets[0]);
    }
  }, []);

  const removeScreenshot = useCallback(() => {
    setScreenshot(null);
  }, []);

  const validate = useCallback(() => {
    if (!issueType.trim()) return 'Please select an issue type.';
    if (!title.trim()) return 'Please add a short title.';
    if (!description.trim()) return 'Please describe the issue.';
    if (!contactEmail.trim()) return 'Please provide a contact email.';
    return null;
  }, [issueType, title, description, contactEmail]);

  const submit = useCallback(async () => {
    const errorMessage = validate();
    if (errorMessage) {
      Alert.alert('Missing info', errorMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error('No auth token available.');
      }

      const formData = new FormData();
      formData.append('issueType', issueType);
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('contactEmail', contactEmail.trim());
      formData.append('metadata', JSON.stringify(metadata));

      if (screenshot?.uri) {
        const fileName = screenshot.fileName || `screenshot-${Date.now()}.jpg`;
        const fileType = screenshot.mimeType || 'image/jpeg';
        formData.append('screenshot', {
          uri: screenshot.uri,
          name: fileName,
          type: fileType,
        } as any);
      }

      const res = await fetch(`${API_BASE}/billing/support`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to submit support request.');
        throw new Error(text || 'Failed to submit support request.');
      }

      Alert.alert('Submitted', 'Thanks! Your support request was sent.');
      (navigation as any).goBack();
    } catch (error: any) {
      Alert.alert('Submission failed', error?.message || 'Unable to send your request.');
    } finally {
      setIsSubmitting(false);
    }
  }, [contactEmail, description, getToken, issueType, metadata, navigation, screenshot, title, validate]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.backBtn}>
          <Icon name="chevron-left" size={28} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Report Subscription Issue</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.cardGroup}>
          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Issue type</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={issueType}
                onValueChange={(value) => setIssueType(String(value))}
              >
                {ISSUE_TYPES.map((type) => (
                  <Picker.Item key={type} label={type} value={type} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={[styles.input, { color: theme.colors.text }]}
              placeholder="Short summary of the issue"
              placeholderTextColor="#9CA3AF"
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View style={styles.separator} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea, { color: theme.colors.text }]}
              placeholder="What happened? Include any steps you took."
              placeholderTextColor="#9CA3AF"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
            />
          </View>

          <View style={styles.separator} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Contact email</Text>
            <TextInput
              style={[styles.input, { color: theme.colors.text }]}
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
              value={contactEmail}
              onChangeText={setContactEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <Text style={styles.sectionHeader}>Screenshot (optional)</Text>
        <View style={styles.cardGroup}>
          <View style={styles.fieldBlock}>
            {screenshot?.uri ? (
              <View>
                <Image source={{ uri: screenshot.uri }} style={styles.screenshot} />
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <TouchableOpacity style={[styles.secondaryBtn, { marginRight: 8 }]} onPress={pickScreenshot}>
                    <Text style={styles.secondaryBtnText}>Replace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={removeScreenshot}>
                    <Text style={styles.secondaryBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.uploadBtn} onPress={pickScreenshot}>
                <Icon name="image-plus" size={18} color="#111827" />
                <Text style={styles.uploadBtnText}>Add screenshot</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.7 }]}
          onPress={submit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Submit</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  cardGroup: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5EA',
    marginBottom: 24,
  },
  fieldBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F9FAFB',
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginLeft: 16,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  uploadBtn: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
  },
  uploadBtnText: { marginLeft: 8, color: '#111827', fontWeight: '600' },
  screenshot: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB',
  },
  secondaryBtnText: { color: '#111827', fontWeight: '600' },
  footer: {
    paddingHorizontal: 16,
    backgroundColor: '#F2F2F7',
  },
  submitBtn: {
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
