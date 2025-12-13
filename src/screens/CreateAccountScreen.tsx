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
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { AuthContext } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Image } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useOrganizationList, useUser } from '@clerk/clerk-expo';
import { useOrg } from '../context/OrgContext';
import * as Crypto from 'expo-crypto';

type AppStackParamList = {
  CreateAccountScreen: undefined;
  TabNavigator: undefined;
  Profile: { openAddConnection?: boolean };
  ProductDetail: { productId: string };
  MappingReview: { connectionId: string; platformName: string };
};

type CreateAccountScreenNavigationProp = StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>;

const CreateAccountScreen = () => {
  // Profile form state
  const [businessName, setBusinessName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [occupation, setOccupation] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Dropdown state
  const [openRegion, setOpenRegion] = useState(false);
  const [openCurrency, setOpenCurrency] = useState(false);

  const authContext = useContext(AuthContext);
  const navigation = useNavigation<CreateAccountScreenNavigationProp>();
  const { createOrganization } = useOrganizationList();
  const { refreshOrgs } = useOrg();
  const { user: clerkUser } = useUser();

  const [regionItems, setRegionItems] = useState([
    { label: 'United States', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'Europe', value: 'EU' },
    { label: 'Other', value: 'Other' },
  ]);

  const [currencyItems, setCurrencyItems] = useState([
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
      // 1. Get current user from Clerk
      if (!clerkUser?.id) {
        throw new Error("User not found. Please log in again.");
      }
      const userId = clerkUser.id;
      const userEmail = clerkUser.primaryEmailAddress?.emailAddress || '';

      // Resolve/Generate UUID to satisfy "exactly as expects" (Users.Id is UUID)
      let dbUserId = '';

      // Check if user already exists in legacy Users table by Email to reuse UUID
      const { data: existingUser } = await supabase
        .from('Users')
        .select('Id')
        .eq('Email', userEmail)
        .maybeSingle();

      if (existingUser?.Id) {
        dbUserId = existingUser.Id;
      } else {
        // Generate a new random UUID if no record exists
        dbUserId = Crypto.randomUUID();
      }

      // 2. Save profile to Supabase with strict UUID
      const { error: upsertError } = await supabase.from('Users').upsert({
        Id: dbUserId, // Using strict UUID
        Email: userEmail,
        PhoneNumber: phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber}`,
        Region: region,
        Occupation: occupation,
        Currency: currency,
      }, { onConflict: 'Id' });

      if (upsertError) {
        console.error('[CreateAccountScreen] Users table upsert error:', upsertError);
        throw upsertError;
      }

      await supabase.from('UserProfiles').upsert({
        UserId: dbUserId, // Using strict UUID
        DisplayName: businessName,
      }, { onConflict: 'UserId' });

      // 3. Create Clerk organization using business name
      console.log('[CreateAccountScreen] Creating Clerk organization:', businessName);
      if (createOrganization) {
        try {
          await createOrganization({ name: businessName });
          console.log('[CreateAccountScreen] Clerk organization created successfully');
        } catch (orgError: any) {
          // If org creation fails (e.g., name already exists), log but continue
          console.warn('[CreateAccountScreen] Clerk org creation warning:', orgError.message);
        }
      }

      // 4. Mark onboarding as complete
      await supabase.from('Users').update({
        isOnboardingComplete: true,
      }).eq('Id', dbUserId);

      // 5. Refresh org context to pick up new org
      if (refreshOrgs) {
        await refreshOrgs();
      }

      // 6. Navigate to Profile screen with flag to open add connection overlay
      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'TabNavigator',
            state: {
              routes: [
                { name: 'Profile', params: { openAddConnection: true } }
              ],
              index: 0,
            }
          }
        ],
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
      <LinearGradient
        colors={['#5c9c00', '#8cc63f', '#5c9c00']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header with Anorha logo */}
        <View style={styles.header}>
          <Image
            source={require('../assets/anorha_logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.headerText}>Anorha</Text>
        </View>

        {/* Scrollable Card */}
        <ScrollView
          style={styles.cardScroll}
          contentContainerStyle={styles.cardScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tell us about your business</Text>
            <Text style={styles.cardSubtitle}>Let's get you set up</Text>

            <Text style={styles.label}>Business Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your Business LLC"
              placeholderTextColor="#9CA3AF"
              value={businessName}
              onChangeText={setBusinessName}
            />

            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+1</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder="(555) 000-0000"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
            </View>

            <Text style={styles.label}>Region</Text>
            <DropDownPicker
              open={openRegion}
              value={region}
              items={regionItems}
              setOpen={setOpenRegion}
              setValue={setRegion}
              setItems={setRegionItems}
              placeholder="Select region..."
              style={styles.dropdown}
              dropDownContainerStyle={styles.dropdownList}
              placeholderStyle={styles.dropdownPlaceholder}
              zIndex={3000}
              onOpen={() => setOpenCurrency(false)}
            />

            <Text style={styles.label}>Role</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Seller, Artist, Shop Owner"
              placeholderTextColor="#9CA3AF"
              value={occupation}
              onChangeText={setOccupation}
            />

            <Text style={styles.label}>Currency</Text>
            <DropDownPicker
              open={openCurrency}
              value={currency}
              items={currencyItems}
              setOpen={setOpenCurrency}
              setValue={setCurrency}
              setItems={setCurrencyItems}
              placeholder="Select currency..."
              style={styles.dropdown}
              dropDownContainerStyle={styles.dropdownList}
              placeholderStyle={styles.dropdownPlaceholder}
              zIndex={2000}
              onOpen={() => setOpenRegion(false)}
            />

            <View style={{ height: 100 }} />
          </View>
        </ScrollView>

        {/* Bottom Action */}
        <View style={styles.bottomAction}>
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleCompleteOnboarding}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Get Started</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  logo: {
    width: 40,
    height: 40,
  },
  headerText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#111',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryCode: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
  phoneInput: {
    flex: 1,
  },
  dropdown: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    minHeight: 48,
  },
  dropdownList: {
    backgroundColor: '#fff',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginTop: 4,
  },
  dropdownPlaceholder: {
    color: '#9CA3AF',
  },
  bottomAction: {
    padding: 20,
    paddingBottom: 40,
  },
  primaryButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default CreateAccountScreen;
