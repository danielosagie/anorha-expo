import React, { useState, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
  Linking,
  Alert,
  SafeAreaView,
  ScrollView,
  Image,
} from 'react-native';
import PhoneInput from 'react-native-phone-number-input';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useOrganizationList, useUser } from '@clerk/clerk-expo';
import { useOrg } from '../context/OrgContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  FadeInDown,
} from 'react-native-reanimated';

const { width } = Dimensions.get('window');

// --- THEME CONSTANTS ---
const THEME = {
  bg: '#93C822',      // Anorha Lime
  primary: 'rgba(0,0,0,0.5)', // Darker semi-transparent black
  secondary: '#0D2B14', // Deep Forest Green (Accents)
  text: '#FFFFFF',    // White text
  textDim: 'rgba(255, 255, 255, 0.9)',
  cardBg: 'rgba(0, 0, 0, 0.18)',
  border: 'rgba(0, 0, 0, 0.25)',
};

type AppStackParamList = {
  CreateAccountScreen: undefined;
  TabNavigator: undefined;
  Profile: { openAddConnection?: boolean };
};

type CreateAccountScreenNavigationProp = StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>;

// --- TYPES ---

type Step =
  | 'WELCOME'
  | 'BUSINESS_NAME'
  | 'BUSINESS_TYPE'
  | 'ROLE'
  | 'CONTACT'
  | 'TEAM'
  | 'FINISH';

interface FormData {
  businessName: string;
  businessType: string;
  customBusinessType: string;
  role: string;
  customRole: string; // [NEW]
  phone: string;
  region: string | null;
  currency: string | null;
  invites: string[];
  locationPermission: boolean;
  notificationPermission: boolean;
  agreedToLegal: boolean; // [NEW]
}

// --- OPTIONS ---

const BUSINESS_TYPES = [
  { id: 'retailer', label: 'Retail Store', icon: 'store' },
  { id: 'brand', label: 'Brand / Manufacturer', icon: 'tag-heart' },
  { id: 'reseller', label: 'Reseller / Flipper', icon: 'swap-horizontal-bold' },
  { id: 'content_creator', label: 'Content Creator', icon: 'video-vintage' },
  { id: 'wholesaler', label: 'Wholesaler / Distributor', icon: 'warehouse' },
  { id: 'other', label: 'Other', icon: 'dots-horizontal' },
];

const ROLES = [
  { id: 'owner', label: 'Store Owner', description: 'I own the business' },
  { id: 'manager', label: 'Manager', description: 'I manage operations' },
  { id: 'employee', label: 'Employee', description: 'I work here' },
  { id: 'other', label: 'Other', description: 'Something else' },
];

const STEPS_ORDER: Step[] = [
  'WELCOME',
  'BUSINESS_NAME',
  'BUSINESS_TYPE',
  'ROLE',
  'CONTACT',
  'TEAM',
  'FINISH'
];

// --- MEMOIZED COMPONENTS ---

const Stepper = memo(({ currentStep }: { currentStep: Step }) => {
  const currentIndex = STEPS_ORDER.indexOf(currentStep);
  // Only show stepper if not welcome
  if (currentStep === 'WELCOME') return null;

  return (
    <View style={styles.stepperContainer}>
      {STEPS_ORDER.slice(1).map((step, index) => { // Skip WELCOME in dots
        const isActive = index <= (currentIndex - 1);
        return (
          <View
            key={step}
            style={[
              styles.stepDot,
              isActive && styles.stepDotActive,
              index === (currentIndex - 1) && { transform: [{ scale: 1.2 }] }
            ]}
          />
        );
      })}
    </View>
  );
});

const WelcomeStep = memo(({ onNext }: { onNext: () => void }) => (
  <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.stepContainer}>
    <View style={styles.logoContainer}>
      <View style={styles.logoBox}>
        <Image source={require('../assets/anorha_logo.png')} style={styles.logoImage} resizeMode="contain" />
      </View>
      <Text style={styles.logoTitle}>anorha</Text>
    </View>
    <Text style={styles.bigTitle}>Finish your setup</Text>
    <Text style={styles.subtitle}>Let's get your business inventory synced.</Text>
    <View style={{ flex: 1 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
      <Text style={styles.primaryButtonText}>Let's Go</Text>
      <Icon name="arrow-right" size={24} color={THEME.bg} />
    </TouchableOpacity>
  </Animated.View>
));

const BusinessNameStep = memo(({ value, onChange, onNext }: { value: string, onChange: (t: string) => void, onNext: () => void }) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What's the name of your business?</Text>
    <TextInput
      style={styles.input}
      placeholder="e.g. Acme Inc"
      placeholderTextColor={THEME.textDim}
      value={value}
      onChangeText={onChange}
      autoFocus
      onSubmitEditing={onNext}
    />
    <View style={{ flex: 1 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
      <Text style={styles.primaryButtonText}>Next</Text>
    </TouchableOpacity>
  </Animated.View>
));

const BusinessTypeStep = memo(({
  businessName,
  selectedType,
  customType,
  onSelect,
  onCustomChange,
  onNext
}: {
  businessName: string,
  selectedType: string,
  customType: string,
  onSelect: (id: string) => void,
  onCustomChange: (t: string) => void,
  onNext: () => void
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What type of business is {businessName}?</Text>
    <View style={styles.grid}>
      {BUSINESS_TYPES.map((type) => (
        <TouchableOpacity
          key={type.id}
          style={[styles.card, selectedType === type.id && styles.cardActive]}
          onPress={() => onSelect(type.id)}
        >
          <Icon name={type.icon} size={28} color={selectedType === type.id ? THEME.bg : THEME.primary} />
          <Text style={[styles.cardText, selectedType === type.id && styles.cardTextActive]}>{type.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
    {selectedType === 'other' && (
      <Animated.View entering={FadeInDown} style={{ marginTop: 24 }}>
        <Text style={styles.label}>Please specify</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Service Provider"
          placeholderTextColor={THEME.textDim}
          value={customType}
          onChangeText={onCustomChange}
          autoFocus // Focus when revealed
          onSubmitEditing={onNext}
        />
      </Animated.View>
    )}
    <View style={{ flex: 1 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
      <Text style={styles.primaryButtonText}>Next</Text>
    </TouchableOpacity>
  </Animated.View>
));

const RoleStep = memo(({
  selectedRole,
  customRole,
  onSelect,
  onCustomChange,
  onNext
}: {
  selectedRole: string,
  customRole: string,
  onSelect: (id: string) => void,
  onCustomChange: (t: string) => void,
  onNext: () => void
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What is your role?</Text>
    <View style={styles.listContainer}>
      {ROLES.map((role) => (
        <TouchableOpacity
          key={role.id}
          style={[styles.listCard, selectedRole === role.id && styles.cardActive]}
          onPress={() => onSelect(role.id)}
        >
          <View>
            <Text style={[styles.listCardTitle, selectedRole === role.id && styles.cardTextActive]}>{role.label}</Text>
            <Text style={[styles.listCardDesc, selectedRole === role.id && { color: 'rgba(0,0,0,0.6)' }]}>{role.description}</Text>
          </View>
          {selectedRole === role.id && <Icon name="check-circle" size={24} color={THEME.bg} />}
        </TouchableOpacity>
      ))}
    </View>

    {/* Typeable Other for Role */}
    {selectedRole === 'other' && (
      <Animated.View entering={FadeInDown} style={{ marginTop: 24 }}>
        <Text style={styles.label}>Please specify role</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Consultant"
          placeholderTextColor={THEME.textDim}
          value={customRole}
          onChangeText={onCustomChange}
          autoFocus
          onSubmitEditing={onNext}
        />
      </Animated.View>
    )}

    <View style={{ flex: 1 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
      <Text style={styles.primaryButtonText}>Next</Text>
    </TouchableOpacity>
  </Animated.View>
));

const ContactStep = memo(({
  phone,
  onChangeFormatted,
  onNext,
  inputRef
}: {
  phone: string,
  onChangeFormatted: (text: string) => void,
  onNext: () => void,
  inputRef: any
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What's your number?</Text>
    <Text style={styles.subtitle}>We use this for secure account recovery and urgent alerts.</Text>
    <View style={{ marginTop: 32 }}>
      {/* Styled Container Wrapper */}
      <View style={styles.phoneInputWrapper}>
        <PhoneInput
          ref={inputRef}
          defaultValue={phone}
          defaultCode="US"
          layout="first"
          onChangeFormattedText={onChangeFormatted}
          withDarkTheme
          containerStyle={styles.phoneContainer}
          textContainerStyle={styles.phoneTextContainer}
          textInputStyle={styles.phoneInput}
          codeTextStyle={styles.phoneCode}
          flagButtonStyle={styles.flagButton}
          countryPickerButtonStyle={styles.countryPickerButton}
        />
      </View>
    </View>
    <View style={{ flex: 1 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
      <Text style={styles.primaryButtonText}>Next</Text>
    </TouchableOpacity>
  </Animated.View>
));

const TeamStep = memo(({
  invites,
  inviteEmail,
  onEmailChange,
  onAdd,
  onRemove,
  onNext
}: {
  invites: string[],
  inviteEmail: string,
  onEmailChange: (t: string) => void,
  onAdd: () => void,
  onRemove: (e: string) => void,
  onNext: () => void
}) => {
  return (
    <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Invite your teammates</Text>
      <Text style={styles.subtitle}>Work better together.</Text>
      <View style={{ marginTop: 24 }}>
        <View style={styles.inviteRow}>
          <TextInput
            style={styles.inviteInput}
            placeholder="colleague@example.com"
            placeholderTextColor={THEME.textDim}
            value={inviteEmail}
            onChangeText={onEmailChange}
            autoCapitalize="none"
            keyboardType="email-address"
            onSubmitEditing={onAdd}
          />
          <TouchableOpacity style={styles.addButton} onPress={onAdd}>
            <Icon name="plus" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.inviteList}>
          {invites.map((email, index) => (
            <View key={index} style={styles.inviteItem}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.inviteAvatar}>
                  <Text style={styles.inviteInitials}>{email.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.inviteEmail}>{email}</Text>
              </View>
              <TouchableOpacity onPress={() => onRemove(email)}>
                <Icon name="close-circle" size={20} color={THEME.textDim} />
              </TouchableOpacity>
            </View>
          ))}
          {invites.length === 0 && (
            <Text style={styles.emptyText}>No invites added yet.</Text>
          )}
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
        <Text style={styles.primaryButtonText}>{invites.length > 0 ? "Next" : "Skip"}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

const PermissionsAndLegalStep = memo(({
  locPerm,
  notifPerm,
  agreed,
  loading,
  onRequestLoc,
  onRequestNotif,
  onToggleAgree,
  onFinish
}: {
  locPerm: boolean,
  notifPerm: boolean,
  agreed: boolean,
  loading: boolean,
  onRequestLoc: () => void,
  onRequestNotif: () => void,
  onToggleAgree: () => void,
  onFinish: () => void
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>Review & Finish</Text>
    <Text style={styles.subtitle}>Enable specific features to get the most out of Anorha.</Text>

    <View style={{ marginTop: 32, gap: 16 }}>
      {/* Location */}
      <TouchableOpacity style={styles.permCard} onPress={onRequestLoc}>
        <View style={[styles.iconCircle, { backgroundColor: locPerm ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)' }]}>
          <Icon name="map-marker" size={24} color={locPerm ? THEME.secondary : THEME.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Use my Location</Text>
          <Text style={styles.permDesc}>{locPerm ? "Region & Currency set" : "To auto-detect Region & Currency"}</Text>
        </View>
        {locPerm ? <Icon name="check" size={24} color={THEME.secondary} /> : <Icon name="chevron-right" size={24} color={THEME.textDim} />}
      </TouchableOpacity>

      {/* Notification */}
      <TouchableOpacity style={styles.permCard} onPress={onRequestNotif}>
        <View style={[styles.iconCircle, { backgroundColor: notifPerm ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)' }]}>
          <Icon name="bell" size={24} color={notifPerm ? THEME.secondary : THEME.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Enable Notifications</Text>
          <Text style={styles.permDesc}>{notifPerm ? "Enabled" : "For sync alerts & updates"}</Text>
        </View>
        {notifPerm ? <Icon name="check" size={24} color={THEME.secondary} /> : <Icon name="chevron-right" size={24} color={THEME.textDim} />}
      </TouchableOpacity>
    </View>

    {/* Legal Section at Bottom */}
    <View style={{ marginTop: 32, padding: 16, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 16 }}>
      <TouchableOpacity style={styles.checkboxRow} onPress={onToggleAgree}>
        <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
          {agreed && <Icon name="check" size={16} color="#FFFFFF" />}
        </View>
        <Text style={styles.checkboxText}>I have read and agree to the policies.</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 20 }}>
        <TouchableOpacity onPress={() => Linking.openURL('https://anorha.app/terms')}>
          <Text style={styles.legalLinkSmall}>Terms of Service</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('https://anorha.app/privacy')}>
          <Text style={styles.legalLinkSmall}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </View>

    <View style={{ flex: 1 }} />
    <TouchableOpacity
      style={[styles.primaryButton, (!agreed || loading) && { opacity: 0.5 }]}
      onPress={onFinish}
      disabled={!agreed || loading}
    >
      {loading ? <ActivityIndicator color={THEME.bg} /> : <Text style={styles.primaryButtonText}>Agree & Finish</Text>}
    </TouchableOpacity>
  </Animated.View>
));

// --- MAIN COMPONENT ---

export default function CreateAccountScreen() {
  const navigation = useNavigation<CreateAccountScreenNavigationProp>();
  const { user: clerkUser } = useUser();
  const { createOrganization } = useOrganizationList();
  const { refreshOrgs } = useOrg();

  // State
  const [currentStep, setCurrentStep] = useState<Step>('WELCOME');
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    businessName: '',
    businessType: '',
    customBusinessType: '',
    role: '',
    customRole: '',
    phone: '',
    region: 'US', // Default fallbacks
    currency: 'USD',
    invites: [],
    locationPermission: false,
    notificationPermission: false,
    agreedToLegal: false,
  });

  const phoneInputRef = useRef<PhoneInput>(null);
  const [formattedPhone, setFormattedPhone] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  // --- ACTIONS ---

  const goToStep = useCallback((step: Step) => {
    setCurrentStep(step);
  }, []);

  const handleNext = useCallback(async () => {
    if (currentStep === 'BUSINESS_NAME') {
      if (!formData.businessName.trim()) {
        Alert.alert('Missing Info', 'Please enter your business name.');
        return;
      }
      goToStep('BUSINESS_TYPE');
    } else if (currentStep === 'BUSINESS_TYPE') {
      if (!formData.businessType) {
        Alert.alert('Missing Info', 'Please select a business type.');
        return;
      }
      if (formData.businessType === 'other' && !formData.customBusinessType.trim()) {
        Alert.alert('Missing Info', 'Please specify your business type.');
        return;
      }
      goToStep('ROLE');
    } else if (currentStep === 'ROLE') {
      if (!formData.role) {
        Alert.alert('Missing Info', 'Please select your role.');
        return;
      }
      if (formData.role === 'other' && !formData.customRole.trim()) {
        Alert.alert('Missing Info', 'Please specify your role.');
        return;
      }
      goToStep('CONTACT');
    } else if (currentStep === 'CONTACT') {
      if (!formattedPhone || !phoneInputRef.current?.isValidNumber(formattedPhone.replace(/^\+/, ''))) {
        Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
        return;
      }
      setFormData(prev => ({ ...prev, phone: formattedPhone }));
      goToStep('TEAM');
    } else if (currentStep === 'TEAM') {
      goToStep('FINISH');
    }
  }, [currentStep, formData, formattedPhone, goToStep]);

  const addInvite = useCallback(() => {
    const email = inviteEmail.trim();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (formData.invites.includes(email)) {
      Alert.alert('Duplicate', 'This email is already added.');
      return;
    }
    setFormData(prev => ({ ...prev, invites: [...prev.invites, email] }));
    setInviteEmail('');
  }, [inviteEmail, formData.invites]);

  const removeInvite = useCallback((email: string) => {
    setFormData(prev => ({ ...prev, invites: prev.invites.filter(e => e !== email) }));
  }, []);

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Silent or small native alert
        return;
      }

      // Try last known first (Fast & Battery efficient)
      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      }

      if (location) {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });

        if (geocode && geocode.length > 0) {
          const countryCode = geocode[0].isoCountryCode;
          let currency = 'USD';
          let region = 'US';

          if (countryCode === 'CA') { currency = 'CAD'; region = 'CA'; }
          else if (['GB', 'UK'].includes(countryCode || '')) { currency = 'GBP'; region = 'EU'; }
          else if (['DE', 'FR', 'IT', 'ES', 'NL'].includes(countryCode || '')) { currency = 'EUR'; region = 'EU'; }

          setFormData(prev => ({
            ...prev,
            region: region,
            currency: currency,
            locationPermission: true
          }));
          // No large alert, just UI update
        }
      }
    } catch (err) {
      console.log('Location error', err);
    }
  }, []);

  const requestNotifications = useCallback(async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        setFormData(prev => ({ ...prev, notificationPermission: true }));
      }
    } catch (err) {
      console.log('Notif error', err);
    }
  }, []);

  const handleFinish = useCallback(async () => {
    if (!formData.agreedToLegal) return;
    setLoading(true);
    try {
      if (!clerkUser?.id) return;

      // 1. Get the real Supabase User (UUID) via our shimmed getUser()
      // This works because lib/supabase.ts maps getUser() to 'select * from me'
      const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser();

      if (authError || !supabaseUser?.id) {
        console.error('Supabase Auth Error:', authError);
        Alert.alert('Error', 'Could not identify user. Please restart the app.');
        return;
      }

      const dbUserId = supabaseUser.id; // Correct UUID
      const email = clerkUser.primaryEmailAddress?.emailAddress || '';
      const finalBusinessType = formData.businessType === 'other' ? formData.customBusinessType : formData.businessType;
      const finalRole = formData.role === 'other' ? formData.customRole : formData.role;

      // 2. Update the existing user record (created by backend sync)
      // We use UPDATE because the user MUST exist for the token exchange to work.
      const { error: userError } = await supabase.from('Users').update({
        PhoneNumber: formData.phone,
        Region: formData.region || 'US',
        Currency: formData.currency || 'USD',
        Occupation: finalRole,
        BusinessType: finalBusinessType,
        isOnboardingComplete: true
      }).eq('Id', dbUserId);

      if (userError) throw userError;

      // 3. Create/Update Profile (Upsert is safe here as UserProfiles uses UserId as FK)
      await supabase.from('UserProfiles').upsert({
        UserId: dbUserId,
        DisplayName: formData.businessName,
      }, { onConflict: 'UserId' });

      // 4. Sync Clerk Phone
      if (formData.phone) {
        try { await clerkUser.createPhoneNumber({ phoneNumber: formData.phone }); } catch (e) { console.log('Clerk phone sync skipped', e); }
      }

      // 5. Create Org & Invites
      if (createOrganization) {
        try {
          const org = await createOrganization({ name: formData.businessName });
          if (formData.invites.length > 0) {
            for (const email of formData.invites) {
              try { await org.inviteMember({ emailAddress: email, role: 'org:member' }); } catch (inviteErr) { console.warn(`Failed to invite ${email}`, inviteErr); }
            }
          }
        } catch (e) { console.log('Org creation skipped', e); }
      }

      // 6. Push Token
      if (formData.notificationPermission) {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        if (tokenData?.data) {
          await supabase.from('UserDevices').upsert({
            UserId: dbUserId,
            ExpoPushToken: tokenData.data,
            Platform: Platform.OS,
          }, { onConflict: 'UserId, ExpoPushToken' });
        }
      }

      if (refreshOrgs) await refreshOrgs();

      navigation.reset({ index: 0, routes: [{ name: 'TabNavigator' }] });

    } catch (error: any) {
      console.error('Onboarding Error:', error);
      Alert.alert('Error', 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [clerkUser, formData, createOrganization, refreshOrgs, navigation]);


  return (
    <SafeAreaView style={styles.container}>
      {currentStep !== 'WELCOME' && (
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => {
            if (currentStep === 'BUSINESS_NAME') goToStep('WELCOME');
            if (currentStep === 'BUSINESS_TYPE') goToStep('BUSINESS_NAME');
            if (currentStep === 'ROLE') goToStep('BUSINESS_TYPE');
            if (currentStep === 'CONTACT') goToStep('ROLE');
            if (currentStep === 'TEAM') goToStep('CONTACT');
            if (currentStep === 'FINISH') goToStep('TEAM');
          }} style={{ padding: 10 }}>
            <Icon name="arrow-left" size={24} color={THEME.text} />
          </TouchableOpacity>

          <Stepper currentStep={currentStep} />

          <View style={{ width: 44 }} />
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {currentStep === 'WELCOME' && <WelcomeStep onNext={() => goToStep('BUSINESS_NAME')} />}

          {currentStep === 'BUSINESS_NAME' && (
            <BusinessNameStep
              value={formData.businessName}
              onChange={(t) => setFormData(p => ({ ...p, businessName: t }))}
              onNext={handleNext}
            />
          )}

          {currentStep === 'BUSINESS_TYPE' && (
            <BusinessTypeStep
              businessName={formData.businessName}
              selectedType={formData.businessType}
              customType={formData.customBusinessType}
              onSelect={(id) => setFormData(p => ({ ...p, businessType: id }))}
              onCustomChange={(t) => setFormData(p => ({ ...p, customBusinessType: t }))}
              onNext={handleNext}
            />
          )}

          {currentStep === 'ROLE' && (
            <RoleStep
              selectedRole={formData.role}
              customRole={formData.customRole}
              onSelect={(id) => setFormData(p => ({ ...p, role: id }))}
              onCustomChange={(t) => setFormData(p => ({ ...p, customRole: t }))}
              onNext={handleNext}
            />
          )}

          {currentStep === 'CONTACT' && (
            <ContactStep
              phone={formData.phone}
              onChangeFormatted={setFormattedPhone}
              onNext={handleNext}
              inputRef={phoneInputRef}
            />
          )}

          {currentStep === 'TEAM' && (
            <TeamStep
              invites={formData.invites}
              inviteEmail={inviteEmail}
              onEmailChange={setInviteEmail}
              onAdd={addInvite}
              onRemove={removeInvite}
              onNext={handleNext}
            />
          )}

          {currentStep === 'FINISH' && (
            <PermissionsAndLegalStep
              locPerm={formData.locationPermission}
              notifPerm={formData.notificationPermission}
              agreed={formData.agreedToLegal}
              loading={loading}
              onRequestLoc={requestLocation}
              onRequestNotif={requestNotifications}
              onToggleAgree={() => setFormData(p => ({ ...p, agreedToLegal: !p.agreedToLegal }))}
              onFinish={handleFinish}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    height: 50,
  },
  stepperContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  stepDotActive: {
    backgroundColor: THEME.primary,
  },
  stepContainer: {
    flex: 1,
    padding: 24,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 50,
  },
  logoContainer: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 12,
    marginBottom: 48,
    marginTop: 60,
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 60,
    height: 60,
  },
  logoTitle: {
    fontSize: 48,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: THEME.text,
    letterSpacing: -2,
  },
  bigTitle: {
    fontSize: 36,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: THEME.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 32,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: THEME.text,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: THEME.textDim,
    textAlign: 'center',
    lineHeight: 26,
  },
  label: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: THEME.primary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Buttons
  primaryButton: {
    backgroundColor: THEME.primary,
    height: 64,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  primaryButtonText: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#FFFFFF',
  },
  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: (width - 48 - 12) / 2, // 2 columns
    height: 100,
    backgroundColor: THEME.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  cardActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  cardText: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: THEME.text,
    textAlign: 'center',
  },
  cardTextActive: {
    color: THEME.bg,
  },
  // Input
  input: {
    backgroundColor: 'transparent',
    borderBottomWidth: 2,
    borderBottomColor: THEME.border,
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: THEME.text,
    paddingVertical: 12,
  },
  // List Layout (Role)
  listContainer: {
    flexDirection: 'column',
    gap: 12,
    marginTop: 20,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.cardBg,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  listCardTitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: THEME.text,
  },
  listCardDesc: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: THEME.textDim,
    marginTop: 4,
  },
  // Phone
  phoneInputWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  phoneContainer: {
    width: '100%',
    backgroundColor: 'transparent',
    height: 64,
  },
  phoneTextContainer: {
    backgroundColor: 'transparent',
    paddingVertical: 0,
    height: 64,
  },
  phoneInput: {
    color: THEME.text,
    fontSize: 20,
    fontFamily: 'PlusJakartaSans_500Medium',
    height: 64,
  },
  phoneCode: {
    color: THEME.text,
    fontSize: 20,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  flagButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 60,
  },
  countryPickerButton: {
    // 
  },

  // Permissions
  permCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.cardBg,
    padding: 16,
    borderRadius: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permTitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: THEME.text,
    marginBottom: 2,
  },
  permDesc: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: THEME.textDim,
  },
  // Legal Checkbox
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: THEME.textDim,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: THEME.primary,
    borderColor: THEME.primary,
  },
  checkboxText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: THEME.text,
  },

  // Legal Links
  linkText: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: THEME.text,
    textAlign: 'center',
  },
  legalLinkSmall: {
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: THEME.textDim,
    textDecorationLine: 'underline',
  },
  divider: {
    height: 1,
    backgroundColor: THEME.border,
    width: '50%',
    alignSelf: 'center',
  },
  // INvite List
  inviteRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  inviteInput: {
    flex: 1,
    backgroundColor: THEME.cardBg,
    borderRadius: 16,
    paddingHorizontal: 20,
    color: THEME.text,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_500Medium',
    height: 60,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  addButton: {
    width: 60,
    height: 60,
    backgroundColor: THEME.primary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteList: {
    marginTop: 8,
    gap: 8,
  },
  inviteItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.cardBg,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  inviteAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  inviteInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  inviteEmail: {
    color: THEME.text,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  emptyText: {
    color: THEME.textDim,
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  }
});
