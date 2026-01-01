import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Image } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useOrganizationList, useUser } from '@clerk/clerk-expo';
import { useOrg } from '../context/OrgContext';
import * as Crypto from 'expo-crypto';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');
const BRAND_GREEN = '#647653';
const BG_COLOR = '#FFFCF5';

type AppStackParamList = {
  CreateAccountScreen: undefined;
  TabNavigator: undefined;
  Profile: { openAddConnection?: boolean };
  ProductDetail: { productId: string };
  MappingReview: { connectionId: string; platformName: string };
};

type CreateAccountScreenNavigationProp = StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>;

const CreateAccountScreen = () => {
  const [businessName, setBusinessName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [occupation, setOccupation] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [openRegion, setOpenRegion] = useState(false);
  const [openCurrency, setOpenCurrency] = useState(false);

  const authContext = useContext(AuthContext);
  const navigation = useNavigation<CreateAccountScreenNavigationProp>();
  const { createOrganization } = useOrganizationList();
  const { refreshOrgs } = useOrg();
  const { user: clerkUser } = useUser();

  const [regionItems] = useState([
    { label: 'United States', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'Europe', value: 'EU' },
    { label: 'Other', value: 'Other' },
  ]);

  const [currencyItems] = useState([
    { label: 'USD ($)', value: 'USD' },
    { label: 'CAD (C$)', value: 'CAD' },
    { label: 'EUR (€)', value: 'EUR' },
    { label: 'GBP (£)', value: 'GBP' },
  ]);

  const handleCompleteOnboarding = async () => {
    if (!businessName || !phoneNumber || !region || !occupation || !currency) {
      Alert.alert('Missing Information', 'Please fill out all fields to continue.');
      return;
    }

    setLoading(true);
    try {
      if (!clerkUser?.id) throw new Error("User not found. Please log in again.");
      const userId = clerkUser.id;
      const userEmail = clerkUser.primaryEmailAddress?.emailAddress || '';

      let dbUserId = '';
      const { data: existingUser } = await supabase
        .from('Users')
        .select('Id')
        .eq('Email', userEmail)
        .maybeSingle();

      dbUserId = existingUser?.Id || Crypto.randomUUID();

      const { error: upsertError } = await supabase.from('Users').upsert({
        Id: dbUserId,
        Email: userEmail,
        PhoneNumber: phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber}`,
        Region: region,
        Occupation: occupation,
        Currency: currency,
      }, { onConflict: 'Id' });

      if (upsertError) throw upsertError;

      await supabase.from('UserProfiles').upsert({
        UserId: dbUserId,
        DisplayName: businessName,
      }, { onConflict: 'UserId' });

      if (createOrganization) {
        try {
          await createOrganization({ name: businessName });
        } catch (orgError: any) {
          console.warn('[CreateAccountScreen] Clerk org creation warning:', orgError.message);
        }
      }

      await supabase.from('Users').update({ isOnboardingComplete: true }).eq('Id', dbUserId);
      if (refreshOrgs) await refreshOrgs();

      navigation.reset({
        index: 0,
        routes: [{
          name: 'TabNavigator',
          state: {
            routes: [{ name: 'Profile', params: { openAddConnection: true } }],
            index: 0,
          }
        }],
      });

    } catch (error: any) {
      console.error('Onboarding error:', error);
      Alert.alert('Error', error.message || 'Failed to complete setup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header Area */}
            <View style={styles.header}>
              <View style={styles.logoBadge}>
                <Image
                  source={require('../assets/anorha_logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>Finish your setup</Text>
              <Text style={styles.subtitle}>Let's get your business inventory synced.</Text>
            </View>

            {/* Form Card */}
            <View style={styles.card}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Business Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Acme Antiques"
                  placeholderTextColor="#999"
                  value={businessName}
                  onChangeText={setBusinessName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.phoneContainer}>
                  <View style={styles.countryCode}>
                    <Text style={styles.countryCodeText}>+1</Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.phoneInput]}
                    placeholder="(555) 000-0000"
                    placeholderTextColor="#999"
                    keyboardType="phone-pad"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, { zIndex: 3000 }]}>
                <Text style={styles.label}>Region</Text>
                <DropDownPicker
                  open={openRegion}
                  value={region}
                  items={regionItems}
                  setOpen={setOpenRegion}
                  setValue={setRegion}
                  placeholder="Select region"
                  style={styles.dropdown}
                  dropDownContainerStyle={styles.dropdownContainer}
                  placeholderStyle={styles.dropdownPlaceholder}
                  textStyle={styles.dropdownText}
                  onOpen={() => setOpenCurrency(false)}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Role / Occupation</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Store Owner"
                  placeholderTextColor="#999"
                  value={occupation}
                  onChangeText={setOccupation}
                />
              </View>

              <View style={[styles.inputGroup, { zIndex: 2000 }]}>
                <Text style={styles.label}>Primary Currency</Text>
                <DropDownPicker
                  open={openCurrency}
                  value={currency}
                  items={currencyItems}
                  setOpen={setOpenCurrency}
                  setValue={setCurrency}
                  placeholder="Select currency"
                  style={styles.dropdown}
                  dropDownContainerStyle={styles.dropdownContainer}
                  placeholderStyle={styles.dropdownPlaceholder}
                  textStyle={styles.dropdownText}
                  onOpen={() => setOpenRegion(false)}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleCompleteOnboarding}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.primaryButtonText}>Get Started</Text>
                    <Icon name="arrow-right" size={20} color="#fff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  logo: {
    width: 40,
    height: 40,
  },
  title: {
    fontSize: 28,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_400Regular',
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.03,
    shadowRadius: 20,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#444',
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_400Regular',
    color: '#1a1a1a',
  },
  phoneContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  countryCode: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#666',
  },
  phoneInput: {
    flex: 1,
  },
  dropdown: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 14,
    minHeight: 56,
  },
  dropdownContainer: {
    backgroundColor: '#fff',
    borderColor: '#EEE',
    borderRadius: 14,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 10,
  },
  dropdownPlaceholder: {
    color: '#999',
    fontFamily: 'PlusJakartaSans_400Regular',
  },
  dropdownText: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_400Regular',
    color: '#1a1a1a',
  },
  primaryButton: {
    backgroundColor: '#1a1a1a', // Focused Black
    borderRadius: 16,
    height: 60,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default CreateAccountScreen;
