import React, { useState, useRef, useCallback, memo, useContext, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';
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
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import PhoneInput from 'react-native-phone-number-input';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';
import { AudioModule } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { CompositeNavigationProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import type { AuthStackParamList, AppStackParamList } from '../navigation/AppNavigator';
import { useOrganizationList, useUser } from '@clerk/expo';
import { useOrg } from '../context/OrgContext';
import { AuthContext } from '../context/AuthContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { capture, AnalyticsEvents } from '../lib/analytics';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import ConnectAccountsStep from '../components/onboarding/ConnectAccountsStep';
import WelcomeHero from '../components/onboarding/WelcomeHero';
import ErrorModal from '../components/ErrorModal';
import { createLogger } from '../utils/logger';
const log = createLogger('CreateAccountScreen');


const { width } = Dimensions.get('window');
const API_BASE = API_BASE_URL;

// --- THEME (matches the app's design language — Profile / Connections) ---
const ONBOARDING = {
  bg: '#FFFFFF',           // v2 white background
  green: '#93C822',        // Primary green (active buttons, dots, selected cards)
  greenDeep: '#4A7C00',    // Deep-green links
  title: '#1C1B17',        // Primary text (warm ink)
  subtitle: '#6B6A63',     // Secondary text (warm gray)
  dotInactive: '#ECE9DF',  // Inactive pagination dots
  cardBg: '#FBFAF6',       // Warm-white surfaces
  fieldBg: '#F6F5F1',      // Filled field background
  border: '#EAE6DA',       // Hairline borders
};

// CreateAccountScreen can live in AuthStack (signup flow) or AppStack (resume incomplete onboarding).
type CreateAccountScreenNavigationProp = CompositeNavigationProp<
  StackNavigationProp<AuthStackParamList, 'CreateAccountScreen'>,
  StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>
>;

// --- TYPES ---

type Step =
  | 'WELCOME'
  | 'BUSINESS_NAME'
  | 'STORE_ADDRESS'
  | 'BUSINESS_TYPE'
  | 'ROLE'
  | 'CONTACT'
  | 'SELL_WHAT'
  | 'GOAL'
  | 'HEARD'
  | 'TEAM'
  | 'FINISH'
  | 'CONNECT';

interface FormData {
  businessName: string;
  businessType: string;
  customBusinessType: string;
  role: string;
  customRole: string;
  sellCategories: string[];
  goal: string;
  goalOther: string;
  heardFrom: string;
  phone: string;
  region: string | null;
  currency: string | null;
  invites: string[];
  locationPermission: boolean;
  notificationPermission: boolean;
  microphonePermission: boolean;
  cameraPermission: boolean;
  agreedToLegal: boolean;
  // Business Address fields
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
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

const SELL_CATEGORIES = [
  { id: 'clothing', label: 'Clothing', icon: 'tshirt-crew-outline' },
  { id: 'electronics', label: 'Electronics', icon: 'cellphone' },
  { id: 'home', label: 'Home', icon: 'home-outline' },
  { id: 'collectibles', label: 'Collectibles', icon: 'package-variant-closed' },
  { id: 'beauty', label: 'Beauty', icon: 'star-four-points-outline' },
  { id: 'other', label: 'Other', icon: 'view-grid-outline' },
];

const GOALS = [
  { id: 'sell_faster', label: 'Sell faster', icon: 'lightning-bolt-outline' },
  { id: 'list_everywhere', label: 'List everywhere', icon: 'view-grid-outline' },
  { id: 'clear_stock', label: 'Clear out stock', icon: 'archive-outline' },
  { id: 'other', label: 'Other', icon: 'dots-horizontal' },
];

const HEARD_OPTIONS = [
  { id: 'friend', label: 'A friend', icon: 'account-multiple-outline' },
  { id: 'social', label: 'Social media', icon: 'share-variant-outline' },
  { id: 'search', label: 'Search', icon: 'magnify' },
  { id: 'other', label: 'Other', icon: 'dots-horizontal' },
];

const STEPS_ORDER: Step[] = [
  'WELCOME',
  'BUSINESS_NAME',
  'STORE_ADDRESS',
  'BUSINESS_TYPE',
  'ROLE',
  'CONTACT',
  'SELL_WHAT',
  'GOAL',
  'HEARD',
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
            ]}

          />
        );
      })}
    </View>
  );
});

const WELCOME_FEATURES = [
  { icon: 'camera-outline', label: 'Scan it, we list it' },
  { icon: 'sync', label: 'Synced across every platform' },
  { icon: 'star-four-points-outline', label: 'Sprout handles the busywork' },
];

// A row in the mini "My store" preview. When active it lights up + flips its
// status dot to a green check, mirroring the feature being described below.
const PhoneTaskRow = ({ active }: { active: boolean }) => {
  const a = useSharedValue(active ? 1 : 0);
  useEffect(() => { a.value = withTiming(active ? 1 : 0, { duration: 320 }); }, [active, a]);
  const rowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(a.value, [0, 1], ['#FFFFFF', 'rgba(147,200,34,0.18)']),
    borderColor: interpolateColor(a.value, [0, 1], ['#EEEADE', 'rgba(147,200,34,0.65)']),
  }));
  const barStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(a.value, [0, 1], ['#E7E3D6', 'rgba(60,90,20,0.35)']),
  }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: 1 - a.value, transform: [{ scale: 1 - a.value * 0.5 }] }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: a.value, transform: [{ scale: 0.5 + a.value * 0.5 }] }));
  return (
    <Animated.View style={[styles.welcomeListRow, rowStyle]}>
      <View style={styles.welcomeThumb} />
      <Animated.View style={[styles.welcomeBar, barStyle]} />
      <View style={styles.welcomeSelSlot}>
        <Animated.View style={[styles.welcomeDotAbs, dotStyle]} />
        <Animated.View style={[styles.welcomeCheckAbs, checkStyle]}>
          <Icon name="check" size={9} color="#FFFFFF" />
        </Animated.View>
      </View>
    </Animated.View>
  );
};

// A feature row in the card below the hero — brightens in sync with the phone.
const FeatureRow = ({ icon, label, active, showBorder, pinned, onPress }: { icon: string; label: string; active: boolean; showBorder: boolean; pinned: boolean; onPress: () => void }) => {
  const a = useSharedValue(active ? 1 : 0);
  useEffect(() => { a.value = withTiming(active ? 1 : 0, { duration: 360 }); }, [active, a]);
  const rowStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(a.value, [0, 1], ['rgba(147,200,34,0)', 'rgba(147,200,34,0.10)']),
  }));
  const circleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(a.value, [0, 1], ['rgba(147,200,34,0.18)', 'rgba(147,200,34,0.36)']),
    transform: [{ scale: 1 + a.value * 0.06 }],
  }));
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <Animated.View style={[styles.featureRow, showBorder && styles.featureRowBorder, rowStyle]}>
        <Animated.View style={[styles.featureIconCircle, circleStyle]}>
          <Icon name={icon} size={20} color="#3C5A14" />
        </Animated.View>
        <Text style={styles.featureLabel}>{label}</Text>
        {active && (
          <View style={styles.featurePlayBtn}>
            <Icon name={pinned ? 'play' : 'pause'} size={13} color="#5D7E16" />
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
};

const WelcomeStep = memo(({ onNext, showBackButton, onSignOut, firstName }: { onNext: () => void; onBack: () => void; showBackButton: boolean; onSignOut?: () => void; firstName?: string }) => {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive(a => (a + 1) % WELCOME_FEATURES.length), 4500);
    return () => clearInterval(id);
  }, [paused]);
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.stepContainer}>
      {/* Hero — phone on the left, live activity flowing out on the right */}
      <LinearGradient
        colors={['#C7E59B', '#AEDB86']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={styles.welcomeHero}
      >
        <WelcomeHero scene={active} />
      </LinearGradient>

      <Text style={styles.welcomeTitle}>
        Welcome to Anorha{firstName ? `, ${firstName}` : ''}
      </Text>

      <View style={styles.featureCard}>
        {WELCOME_FEATURES.map((f, i) => (
          <FeatureRow
            key={f.label}
            icon={f.icon}
            label={f.label}
            active={active === i}
            pinned={paused && active === i}
            showBorder={i > 0}
            onPress={() => { setActive(i); setPaused(prev => (active === i ? !prev : true)); }}
          />
        ))}
      </View>

      <View style={{ flex: 1, minHeight: 16 }} />

      <View style={{ alignItems: 'center', gap: 16 }}>
        <Text style={styles.getDesktop}>Get the desktop app</Text>
        <TouchableOpacity style={[styles.primaryButton, { width: '100%' }]} onPress={onNext} activeOpacity={0.9}>
          <Text style={styles.primaryButtonText}>Next</Text>
        </TouchableOpacity>
        {!showBackButton && onSignOut && (
          <TouchableOpacity style={[styles.secondaryButton, { width: '100%' }]} onPress={onSignOut} activeOpacity={0.9}>
            <Text style={styles.secondaryButtonText}>Not you? Sign out</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
});

const BusinessNameStep = memo(({ value, onChange, onNext }: { value: string, onChange: (t: string) => void, onNext: () => void }) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What's the name of your business?</Text>
    <TextInput
      style={styles.input}
      placeholder="e.g. Acme Inc"
      placeholderTextColor={ONBOARDING.subtitle}
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

const StoreAddressStep = memo(({
  street1,
  street2,
  city,
  state,
  postalCode,
  country,
  onStreet1Change,
  onStreet2Change,
  onCityChange,
  onStateChange,
  onPostalCodeChange,
  onCountryChange,
  onNext,
  onSkip,
  onUseLocation,
  isLoadingLocation,
}: {
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  onStreet1Change: (t: string) => void;
  onStreet2Change: (t: string) => void;
  onCityChange: (t: string) => void;
  onStateChange: (t: string) => void;
  onPostalCodeChange: (t: string) => void;
  onCountryChange: (t: string) => void;
  onNext: () => void;
  onSkip: () => void;
  onUseLocation: () => void;
  isLoadingLocation?: boolean;
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>Business Address</Text>
    <Text style={styles.subtitle}>This helps us setup shipping & returns for your platforms.</Text>
    <View style={styles.divider} />

    {/* Use My Location Button */}
    <TouchableOpacity
      style={[styles.useLocationButton, isLoadingLocation && { opacity: 0.7 }]}
      onPress={onUseLocation}
      disabled={isLoadingLocation}
      activeOpacity={0.8}
    >
      {isLoadingLocation ? (
        <ActivityIndicator size="small" color={ONBOARDING.title} />
      ) : (
        <Icon name="crosshairs-gps" size={20} color={ONBOARDING.title} />
      )}
      <Text style={styles.useLocationText}>
        {isLoadingLocation ? 'Finding your location...' : 'Use My Location'}
      </Text>
    </TouchableOpacity>

    <View style={{ marginTop: 16, gap: 12 }}>
      <TextInput
        style={styles.input}
        placeholder="Street Address"
        placeholderTextColor={ONBOARDING.subtitle}
        value={street1}
        onChangeText={onStreet1Change}
        autoFocus
        textContentType="streetAddressLine1"
        autoComplete="street-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Apt, Suite, Unit (optional)"
        placeholderTextColor={ONBOARDING.subtitle}
        value={street2}
        onChangeText={onStreet2Change}
        textContentType="streetAddressLine2"
        autoComplete="address-line2"
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TextInput
          style={[styles.input, { flex: 2 }]}
          placeholder="City"
          placeholderTextColor={ONBOARDING.subtitle}
          value={city}
          onChangeText={onCityChange}
          textContentType="addressCity"
          autoComplete="postal-address-locality"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="State"
          placeholderTextColor={ONBOARDING.subtitle}
          value={state}
          onChangeText={onStateChange}
          autoCapitalize="characters"
          maxLength={2}
          textContentType="addressState"
          autoComplete="postal-address-region"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="ZIP Code"
          placeholderTextColor={ONBOARDING.subtitle}
          value={postalCode}
          onChangeText={onPostalCodeChange}
          keyboardType="numeric"
          textContentType="postalCode"
          autoComplete="postal-code"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="US"
          placeholderTextColor={ONBOARDING.subtitle}
          value={country}
          onChangeText={onCountryChange}
          autoCapitalize="characters"
          maxLength={2}
          textContentType="countryName"
          autoComplete="postal-address-country"
        />
      </View>
    </View>

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
          <Icon name={type.icon} size={28} color={selectedType === type.id ? '#FFFFFF' : ONBOARDING.title} />
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
          placeholderTextColor={ONBOARDING.subtitle}
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
            <Text style={[styles.listCardDesc, selectedRole === role.id && { color: 'rgba(255,255,255,0.9)' }]}>{role.description}</Text>
          </View>
          {selectedRole === role.id && <Icon name="check-circle" size={24} color="#FFFFFF" />}
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
          placeholderTextColor={ONBOARDING.subtitle}
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

const SelectRow = memo(({ icon, label, selected, multi, onPress }: { icon: string; label: string; selected: boolean; multi?: boolean; onPress: () => void }) => (
  <TouchableOpacity style={[styles.selectRow, selected && styles.selectRowActive]} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.selectIconCircle}>
      <Icon name={icon} size={20} color="#3C5A14" />
    </View>
    <Text style={styles.selectLabel}>{label}</Text>
    <View style={[styles.selectorBox, selected ? styles.selectorSelected : styles.selectorUnselected]}>
      {selected && (multi ? <Icon name="check" size={14} color="#FFFFFF" /> : <View style={styles.selectorDot} />)}
    </View>
  </TouchableOpacity>
));

const SellWhatStep = memo(({ selected, onToggle, onNext }: { selected: string[]; onToggle: (id: string) => void; onNext: () => void }) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What do you sell?</Text>
    <Text style={styles.subtitle}>Pick all that fit.</Text>
    <View style={styles.selectList}>
      {SELL_CATEGORIES.map(c => (
        <SelectRow key={c.id} icon={c.icon} label={c.label} multi selected={selected.includes(c.id)} onPress={() => onToggle(c.id)} />
      ))}
    </View>
    <View style={{ flex: 1, minHeight: 12 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext} activeOpacity={0.9}>
      <Text style={styles.primaryButtonText}>Continue</Text>
    </TouchableOpacity>
  </Animated.View>
));

const GoalStep = memo(({ goal, goalOther, onSelect, onOtherChange, onNext }: { goal: string; goalOther: string; onSelect: (id: string) => void; onOtherChange: (t: string) => void; onNext: () => void }) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>What's your goal?</Text>
    <View style={styles.selectList}>
      {GOALS.map(g => (
        <SelectRow key={g.id} icon={g.icon} label={g.label} selected={goal === g.id} onPress={() => onSelect(g.id)} />
      ))}
      {goal === 'other' && (
        <Animated.View entering={FadeInDown} style={{ gap: 8, marginTop: 6 }}>
          <Text style={styles.label}>Explain</Text>
          <TextInput
            style={styles.input}
            placeholder="Tell us more"
            placeholderTextColor={ONBOARDING.subtitle}
            value={goalOther}
            onChangeText={onOtherChange}
            autoFocus
            onSubmitEditing={onNext}
          />
        </Animated.View>
      )}
    </View>
    <View style={{ flex: 1, minHeight: 12 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext} activeOpacity={0.9}>
      <Text style={styles.primaryButtonText}>Continue</Text>
    </TouchableOpacity>
  </Animated.View>
));

const HeardStep = memo(({ heard, onSelect, onNext }: { heard: string; onSelect: (id: string) => void; onNext: () => void }) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>Where'd you hear about us?</Text>
    <View style={styles.selectList}>
      {HEARD_OPTIONS.map(h => (
        <SelectRow key={h.id} icon={h.icon} label={h.label} selected={heard === h.id} onPress={() => onSelect(h.id)} />
      ))}
    </View>
    <View style={{ flex: 1, minHeight: 12 }} />
    <TouchableOpacity style={styles.primaryButton} onPress={onNext} activeOpacity={0.9}>
      <Text style={styles.primaryButtonText}>Continue</Text>
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
            placeholderTextColor={ONBOARDING.subtitle}
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
          {invites.map((email) => (
            <View key={email} style={styles.inviteItem}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.inviteAvatar}>
                  <Text style={styles.inviteInitials}>{email.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.inviteEmail}>{email}</Text>
              </View>
              <TouchableOpacity onPress={() => onRemove(email)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close-circle" size={20} color={ONBOARDING.subtitle} />
              </TouchableOpacity>
            </View>
          ))}
          {invites.length === 0 && (
            <Text style={styles.emptyText}>No invites added yet.</Text>
          )}
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.primaryButton} onPress={onNext} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.primaryButtonText}>{invites.length > 0 ? "Next" : "Skip"}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

const PermissionsAndLegalStep = memo(({
  isRequestingLoc,
  isRequestingNotif,
  isRequestingMic,
  isRequestingCamera,
  locPerm,
  notifPerm,
  micPerm,
  cameraPerm,
  agreed,
  loading,
  onRequestLoc,
  onRequestNotif,
  onRequestMic,
  onRequestCamera,
  onToggleAgree,
  onFinish
}: {
  isRequestingLoc: boolean,
  isRequestingNotif: boolean,
  isRequestingMic: boolean,
  isRequestingCamera: boolean,
  locPerm: boolean,
  notifPerm: boolean,
  micPerm: boolean,
  cameraPerm: boolean,
  agreed: boolean,
  loading: boolean,
  onRequestLoc: () => void,
  onRequestNotif: () => void,
  onRequestMic: () => void,
  onRequestCamera: () => void,
  onToggleAgree: () => void,
  onFinish: () => void
}) => (
  <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContainer}>
    <Text style={styles.stepTitle}>Review & Finish</Text>
    <Text style={styles.subtitle}>Enable specific features to get the most out of Anorha</Text>

    <View style={{ marginTop: 32, gap: 16 }}>
      {/* Location */}
      <TouchableOpacity
        style={[styles.permCard, locPerm && { borderWidth: 2, borderColor: ONBOARDING.green, backgroundColor: 'rgba(92,156,0,0.12)' }]}
        onPress={onRequestLoc}
        activeOpacity={0.8}
        disabled={isRequestingLoc || locPerm}
      >
        <View style={[styles.iconCircle, { backgroundColor: locPerm ? 'rgba(92,156,0,0.25)' : 'rgba(0,0,0,0.15)' }]}>
          {isRequestingLoc ? (
            <ActivityIndicator size="small" color={ONBOARDING.title} />
          ) : (
            <Icon name="map-marker" size={24} color={locPerm ? ONBOARDING.green : ONBOARDING.title} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Use my Location</Text>
          <Text style={styles.permDesc}>{locPerm ? "Region & Currency set" : "To auto-detect Region & Currency"}</Text>
        </View>
        {locPerm ? <Icon name="check-circle" size={24} color={ONBOARDING.green} /> : <Icon name="chevron-right" size={24} color={ONBOARDING.title} />}
      </TouchableOpacity>

      {/* Notification */}
      <TouchableOpacity
        style={[styles.permCard, notifPerm && { borderWidth: 2, borderColor: ONBOARDING.green, backgroundColor: 'rgba(92,156,0,0.12)' }]}
        onPress={onRequestNotif}
        activeOpacity={0.8}
        disabled={isRequestingNotif || notifPerm}
      >
        <View style={[styles.iconCircle, { backgroundColor: notifPerm ? 'rgba(92,156,0,0.25)' : 'rgba(0,0,0,0.15)' }]}>
          {isRequestingNotif ? (
            <ActivityIndicator size="small" color={ONBOARDING.title} />
          ) : (
            <Icon name="bell" size={24} color={notifPerm ? ONBOARDING.green : ONBOARDING.title} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Enable Notifications</Text>
          <Text style={styles.permDesc}>{notifPerm ? "Enabled" : "For sync alerts & updates"}</Text>
        </View>
        {notifPerm ? <Icon name="check-circle" size={24} color={ONBOARDING.green} /> : <Icon name="chevron-right" size={24} color={ONBOARDING.title} />}
      </TouchableOpacity>

      {/* Microphone */}
      <TouchableOpacity
        style={[styles.permCard, micPerm && { borderWidth: 2, borderColor: ONBOARDING.green, backgroundColor: 'rgba(92,156,0,0.12)' }]}
        onPress={onRequestMic}
        activeOpacity={0.8}
        disabled={isRequestingMic || micPerm}
      >
        <View style={[styles.iconCircle, { backgroundColor: micPerm ? 'rgba(92,156,0,0.25)' : 'rgba(0,0,0,0.15)' }]}>
          {isRequestingMic ? (
            <ActivityIndicator size="small" color={ONBOARDING.title} />
          ) : (
            <Icon name="microphone" size={24} color={micPerm ? ONBOARDING.green : ONBOARDING.title} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Enable Microphone</Text>
          <Text style={styles.permDesc}>{micPerm ? "Enabled" : "For voice search & commands"}</Text>
        </View>
        {micPerm ? <Icon name="check-circle" size={24} color={ONBOARDING.green} /> : <Icon name="chevron-right" size={24} color={ONBOARDING.title} />}
      </TouchableOpacity>

      {/* Camera */}
      <TouchableOpacity
        style={[styles.permCard, cameraPerm && { borderWidth: 2, borderColor: ONBOARDING.green, backgroundColor: 'rgba(92,156,0,0.12)' }]}
        onPress={onRequestCamera}
        activeOpacity={0.8}
        disabled={isRequestingCamera || cameraPerm}
      >
        <View style={[styles.iconCircle, { backgroundColor: cameraPerm ? 'rgba(92,156,0,0.25)' : 'rgba(0,0,0,0.15)' }]}>
          {isRequestingCamera ? (
            <ActivityIndicator size="small" color={ONBOARDING.title} />
          ) : (
            <Icon name="camera" size={24} color={cameraPerm ? ONBOARDING.green : ONBOARDING.title} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.permTitle}>Enable Camera</Text>
          <Text style={styles.permDesc}>{cameraPerm ? "Enabled" : "For scanning barcodes & photos"}</Text>
        </View>
        {cameraPerm ? <Icon name="check-circle" size={24} color={ONBOARDING.green} /> : <Icon name="chevron-right" size={24} color={ONBOARDING.title} />}
      </TouchableOpacity>
    </View>

    {/* Legal Section at Bottom */}
    <View style={{ marginTop: 32, padding: 16, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 16 }}>
      <TouchableOpacity style={styles.checkboxRow} onPress={onToggleAgree} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      {loading ? <ActivityIndicator color={ONBOARDING.green} /> : <Text style={styles.primaryButtonText}>Agree & Finish</Text>}
    </TouchableOpacity>
  </Animated.View>
));

// --- MAIN COMPONENT ---

export default function CreateAccountScreen() {
  const navigation = useNavigation<CreateAccountScreenNavigationProp>();
  const route = useRoute<any>();
  const authContext = useContext(AuthContext);
  const { user: clerkUser } = useUser();
  const { createOrganization } = useOrganizationList();
  const { refreshOrgs } = useOrg();
  const insets = useSafeAreaInsets();

  // State
  const [currentStep, setCurrentStep] = useState<Step>((route.params?.initialStep as Step) || 'WELCOME');
  const [loading, setLoading] = useState(false);
  // Org created at FINISH — handed to the CONNECT step so connections link to it.
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [isRequestingLoc, setIsRequestingLoc] = useState(false);
  const [isRequestingNotif, setIsRequestingNotif] = useState(false);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    businessName: '',
    businessType: '',
    customBusinessType: '',
    role: '',
    customRole: '',
    sellCategories: [],
    goal: '',
    goalOther: '',
    heardFrom: '',
    phone: '',
    region: 'US',
    currency: 'USD',
    invites: [],
    locationPermission: false,
    notificationPermission: false,
    microphonePermission: false,
    cameraPermission: false,
    agreedToLegal: false,
    // Business Address
    street1: '',
    street2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
  });

  // Refs for stable callbacks
  const formDataRef = useRef(formData);
  const phoneInputRef = useRef<PhoneInput>(null);

  // Update ref on render
  formDataRef.current = formData;

  const [formattedPhone, setFormattedPhone] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [errorModal, setErrorModal] = useState<{ visible: boolean; type: 'error' | 'warning' | 'info' | 'success'; title: string; message: string }>({ visible: false, type: 'warning', title: '', message: '' });
  const showModal = useCallback((title: string, message: string, type: 'error' | 'warning' | 'info' | 'success' = 'warning') => setErrorModal({ visible: true, type, title, message }), []);
  const closeModal = useCallback(() => setErrorModal(p => ({ ...p, visible: false })), []);

  // --- ACTIONS ---

  const goToStep = useCallback((step: Step) => {
    setCurrentStep(step);
  }, []);

  // Stable handlers
  const setBusinessName = useCallback((t: string) => setFormData(p => ({ ...p, businessName: t })), []);
  const setStreet1 = useCallback((t: string) => setFormData(p => ({ ...p, street1: t })), []);
  const setStreet2 = useCallback((t: string) => setFormData(p => ({ ...p, street2: t })), []);
  const setCity = useCallback((t: string) => setFormData(p => ({ ...p, city: t })), []);
  const setState = useCallback((t: string) => setFormData(p => ({ ...p, state: t })), []);
  const setPostalCode = useCallback((t: string) => setFormData(p => ({ ...p, postalCode: t })), []);
  const setCountry = useCallback((t: string) => setFormData(p => ({ ...p, country: t })), []);
  const setBusinessType = useCallback((id: string) => setFormData(p => ({ ...p, businessType: id })), []);
  const setCustomBusinessType = useCallback((t: string) => setFormData(p => ({ ...p, customBusinessType: t })), []);
  const setRole = useCallback((id: string) => setFormData(p => ({ ...p, role: id })), []);
  const setCustomRole = useCallback((t: string) => setFormData(p => ({ ...p, customRole: t })), []);
  const toggleSellCategory = useCallback((id: string) => setFormData(p => ({
    ...p,
    sellCategories: p.sellCategories.includes(id)
      ? p.sellCategories.filter(c => c !== id)
      : [...p.sellCategories, id],
  })), []);
  const setGoal = useCallback((id: string) => setFormData(p => ({ ...p, goal: id, goalOther: id === 'other' ? p.goalOther : '' })), []);
  const setGoalOther = useCallback((t: string) => setFormData(p => ({ ...p, goalOther: t })), []);
  const setHeardFrom = useCallback((id: string) => setFormData(p => ({ ...p, heardFrom: id })), []);

  // Use My Location for address autofill
  const handleUseLocation = useCallback(async () => {
    try {
      setIsLoadingAddress(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showModal('Permission Denied', 'Please allow location access to use this feature.', 'warning');
        return;
      }

      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      }

      if (location) {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });

        if (geocode && geocode.length > 0) {
          const addr = geocode[0];
          setFormData(prev => ({
            ...prev,
            street1: addr.streetNumber && addr.street
              ? `${addr.streetNumber} ${addr.street}`
              : addr.street || addr.name || '',
            city: addr.city || addr.subregion || '',
            state: addr.region || '',
            postalCode: addr.postalCode || '',
            country: addr.isoCountryCode || 'US',
          }));
        } else {
          showModal('Location Error', 'Could not determine your address. Please enter it manually.', 'error');
        }
      }
    } catch (err) {
      showModal('Location Error', 'Could not get your location. Please enter your address manually.', 'error');
    } finally {
      setIsLoadingAddress(false);
    }
  }, []);

  const handleNext = useCallback(async () => {
    const currentFormData = formDataRef.current;

    if (currentStep === 'BUSINESS_NAME') {
      if (!currentFormData.businessName.trim()) {
        showModal('Missing Info', 'Please enter your business name.', 'warning');
        return;
      }
      goToStep('STORE_ADDRESS');
    } else if (currentStep === 'STORE_ADDRESS') {
      if (
        !currentFormData.street1.trim() ||
        !currentFormData.city.trim() ||
        !currentFormData.state.trim() ||
        !currentFormData.postalCode.trim()
      ) {
        showModal('Address needed', 'Please add your business address so we can set up shipping & returns.', 'warning');
        return;
      }
      goToStep('BUSINESS_TYPE');
    } else if (currentStep === 'BUSINESS_TYPE') {
      if (!currentFormData.businessType) {
        showModal('Missing Info', 'Please select a business type.', 'warning');
        return;
      }
      if (currentFormData.businessType === 'other' && !currentFormData.customBusinessType.trim()) {
        showModal('Missing Info', 'Please specify your business type.', 'warning');
        return;
      }
      goToStep('ROLE');
    } else if (currentStep === 'ROLE') {
      if (!currentFormData.role) {
        showModal('Missing Info', 'Please select your role.', 'warning');
        return;
      }
      if (currentFormData.role === 'other' && !currentFormData.customRole.trim()) {
        showModal('Missing Info', 'Please specify your role.', 'warning');
        return;
      }
      goToStep('CONTACT');
    } else if (currentStep === 'CONTACT') {
      if (!formattedPhone || !phoneInputRef.current?.isValidNumber(formattedPhone.replace(/^\+/, ''))) {
        showModal('Invalid Phone', 'Please enter a valid phone number.', 'warning');
        return;
      }
      setFormData(prev => ({ ...prev, phone: formattedPhone }));
      goToStep('SELL_WHAT');
    } else if (currentStep === 'SELL_WHAT') {
      goToStep('GOAL');
    } else if (currentStep === 'GOAL') {
      goToStep('HEARD');
    } else if (currentStep === 'HEARD') {
      goToStep('TEAM');
    } else if (currentStep === 'TEAM') {
      goToStep('FINISH');
    }
  }, [currentStep, formattedPhone, goToStep]);

  const addInvite = useCallback(() => {
    const email = inviteEmail.trim();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showModal('Invalid Email', 'Please enter a valid email address.', 'warning');
      return;
    }
    if (formData.invites.includes(email)) {
      showModal('Duplicate', 'This email is already added.', 'warning');
      return;
    }
    setFormData(prev => ({ ...prev, invites: [...prev.invites, email] }));
    setInviteEmail('');
  }, [inviteEmail, formData.invites]);

  const removeInvite = useCallback((email: string) => {
    setFormData(prev => ({ ...prev, invites: prev.invites.filter(e => e !== email) }));
  }, []);

  const requestLocation = useCallback(async () => {
    if (isRequestingLoc) return;
    setIsRequestingLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission',
          'We need your location to auto-detect your region and currency. Please enable it in settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
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
        }
      }
    } catch (err) {
      // ignore
    } finally {
      setIsRequestingLoc(false);
    }
  }, [isRequestingLoc]);

  const requestNotifications = useCallback(async () => {
    if (isRequestingNotif) return;
    setIsRequestingNotif(true);
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      // If already granted, just update state
      if (existingStatus === 'granted') {
        setFormData(prev => ({ ...prev, notificationPermission: true }));
        return;
      }

      // If already denied, prompt settings
      if (existingStatus === 'denied') {
        Alert.alert(
          'Notifications are disabled',
          'To receive sync alerts and updates, please enable notifications in settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
        setFormData(prev => ({ ...prev, notificationPermission: false }));
        return;
      }

      // Request new
      const { status } = await Notifications.requestPermissionsAsync();
      setFormData(prev => ({ ...prev, notificationPermission: status === 'granted' }));

    } catch (err) {
      setFormData(prev => ({ ...prev, notificationPermission: false }));
    } finally {
      setIsRequestingNotif(false);
    }
  }, [isRequestingNotif]);

  const requestMicrophone = useCallback(async () => {
    if (isRequestingMic) return;
    setIsRequestingMic(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();

      // If already granted, just update state
      if (permission.granted) {
        setFormData(prev => ({ ...prev, microphonePermission: true }));
        return;
      }

      // If denied, prompt settings. Note: permission.status might also be helpful
      if (!permission.granted && !permission.canAskAgain) {
        Alert.alert(
          'Microphone Access Disabled',
          'To use voice search and voice commands, please enable microphone access in settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
        setFormData(prev => ({ ...prev, microphonePermission: false }));
        return;
      }

      setFormData(prev => ({ ...prev, microphonePermission: permission.granted }));

    } catch (err) {
      setFormData(prev => ({ ...prev, microphonePermission: false }));
    } finally {
      setIsRequestingMic(false);
    }
  }, [isRequestingMic]);

  const requestCamera = useCallback(async () => {
    if (isRequestingCamera) return;
    setIsRequestingCamera(true);
    try {
      const { status: existingStatus } = await Camera.getCameraPermissionsAsync();

      // If already granted, just update state
      if (existingStatus === 'granted') {
        setFormData(prev => ({ ...prev, cameraPermission: true }));
        return;
      }

      // If already denied, prompt settings
      if (existingStatus === 'denied') {
        Alert.alert(
          'Camera Access Disabled',
          'To scan barcodes and take photos, please enable camera access in settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
        setFormData(prev => ({ ...prev, cameraPermission: false }));
        return;
      }

      // Request new
      const { status } = await Camera.requestCameraPermissionsAsync();
      setFormData(prev => ({ ...prev, cameraPermission: status === 'granted' }));

    } catch (err) {
      setFormData(prev => ({ ...prev, cameraPermission: false }));
    } finally {
      setIsRequestingCamera(false);
    }
  }, [isRequestingCamera]);

  const handleFinish = useCallback(async () => {
    if (!formData.agreedToLegal) return;
    setLoading(true);
    try {
      if (!clerkUser?.id) return;

      // 1. Get the real Supabase User (UUID) via our shimmed getUser()
      // This works because lib/supabase.ts maps getUser() to 'select * from me'
      const { data: { user: supabaseUser }, error: authError } = await supabase.auth.getUser();

      if (authError || !supabaseUser?.id) {
        log.error('Supabase Auth Error:', authError);
        showModal('Error', 'Could not identify user. Please restart the app.', 'error');
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
        try { await clerkUser.createPhoneNumber({ phoneNumber: formData.phone }); } catch (e) { /* ignore */ }
      }

      // 5. Create Org & Invites
      let createdOrgId: string | null = null;
      if (createOrganization) {
        try {
          const org = await createOrganization({ name: formData.businessName });
          createdOrgId = org?.id || null;
          if (formData.invites.length > 0) {
            for (const email of formData.invites) {
              try { await org.inviteMember({ emailAddress: email, role: 'org:member' }); } catch (inviteErr) { log.warn(`Failed to invite ${email}`, inviteErr); }
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 5.5 Update org business address (includes phone)
      if (createdOrgId) {
        const hasAddressOrPhone = !!(
          formData.street1 ||
          formData.city ||
          formData.postalCode ||
          formData.state ||
          formData.country ||
          formData.phone
        );
        if (hasAddressOrPhone) {
          try {
            const token = await ensureSupabaseJwt();
            if (token) {
              await fetch(`${API_BASE}/api/organizations/${createdOrgId}/address`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  name: formData.businessName,
                  street1: formData.street1,
                  street2: formData.street2,
                  city: formData.city,
                  state: formData.state,
                  postalCode: formData.postalCode,
                  country: formData.country,
                  phone: formData.phone,
                }),
              });
            } else {
              log.warn('[CreateAccount] Missing Supabase JWT; skipped org business address update');
            }
          } catch (addrErr) {
            // Error handling
          }
        }
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

      capture(AnalyticsEvents.ONBOARDING_COMPLETED, {
        create_organization: !!createOrganization,
        sell_categories: formData.sellCategories,
        goal: formData.goal === 'other' ? (formData.goalOther || 'other') : formData.goal,
        heard_from: formData.heardFrom,
      });

      // Onboarding data is saved and the org exists. Hand off to the (skippable)
      // CONNECT step so the user can hook up their stores — connecting there kicks
      // off a background inventory pull + draft mappings via the new org.
      setCreatedOrgId(createdOrgId);
      setCurrentStep('CONNECT');

    } catch (error: any) {
      showModal('Error', 'Setup failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [clerkUser, formData, createOrganization, refreshOrgs, navigation]);

  // Leave onboarding for the main app (from the CONNECT step: "Continue" or skip).
  const finishToApp = useCallback(() => {
    (navigation as StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>).reset({
      index: 0,
      routes: [{ name: 'TabNavigator' }],
    });
  }, [navigation]);


  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ErrorModal
        visible={errorModal.visible}
        type={errorModal.type}
        title={errorModal.title}
        message={errorModal.message}
        onClose={closeModal}
      />
      {currentStep !== 'WELCOME' && currentStep !== 'CONNECT' && (
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => {
            if (currentStep === 'BUSINESS_NAME') goToStep('WELCOME');
            if (currentStep === 'STORE_ADDRESS') goToStep('BUSINESS_NAME');
            if (currentStep === 'BUSINESS_TYPE') goToStep('STORE_ADDRESS');
            if (currentStep === 'ROLE') goToStep('BUSINESS_TYPE');
            if (currentStep === 'CONTACT') goToStep('ROLE');
            if (currentStep === 'SELL_WHAT') goToStep('CONTACT');
            if (currentStep === 'GOAL') goToStep('SELL_WHAT');
            if (currentStep === 'HEARD') goToStep('GOAL');
            if (currentStep === 'TEAM') goToStep('HEARD');
            if (currentStep === 'FINISH') goToStep('TEAM');
          }} style={{ padding: 10 }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
            <Icon name="chevron-left" size={26} color={ONBOARDING.title} />
          </TouchableOpacity>

          <Stepper currentStep={currentStep} />

          {currentStep === 'SELL_WHAT' || currentStep === 'GOAL' || currentStep === 'HEARD' ? (
            <TouchableOpacity onPress={handleNext} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ minWidth: 44, alignItems: 'flex-end', paddingRight: 4 }}>
              <Text style={styles.skipHeaderText}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom, 20) }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {currentStep === 'WELCOME' && (
            <WelcomeStep
              onNext={() => goToStep('BUSINESS_NAME')}
              onBack={() => { if (navigation.canGoBack()) navigation.goBack(); }}
              showBackButton={navigation.canGoBack()}
              onSignOut={() => authContext?.signOut()}
              firstName={clerkUser?.firstName ?? undefined}
            />
          )}

          {currentStep === 'BUSINESS_NAME' && (
            <BusinessNameStep
              value={formData.businessName}
              onChange={setBusinessName}
              onNext={handleNext}
            />
          )}

          {currentStep === 'STORE_ADDRESS' && (
            <StoreAddressStep
              street1={formData.street1}
              street2={formData.street2}
              city={formData.city}
              state={formData.state}
              postalCode={formData.postalCode}
              country={formData.country}
              onStreet1Change={setStreet1}
              onStreet2Change={setStreet2}
              onCityChange={setCity}
              onStateChange={setState}
              onPostalCodeChange={setPostalCode}
              onCountryChange={setCountry}
              onNext={handleNext}
              onSkip={() => goToStep('BUSINESS_TYPE')}
              onUseLocation={handleUseLocation}
              isLoadingLocation={isLoadingAddress}
            />
          )}

          {currentStep === 'BUSINESS_TYPE' && (
            <BusinessTypeStep
              businessName={formData.businessName}
              selectedType={formData.businessType}
              customType={formData.customBusinessType}
              onSelect={setBusinessType}
              onCustomChange={setCustomBusinessType}
              onNext={handleNext}
            />
          )}

          {currentStep === 'ROLE' && (
            <RoleStep
              selectedRole={formData.role}
              customRole={formData.customRole}
              onSelect={setRole}
              onCustomChange={setCustomRole}
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

          {currentStep === 'SELL_WHAT' && (
            <SellWhatStep
              selected={formData.sellCategories}
              onToggle={toggleSellCategory}
              onNext={handleNext}
            />
          )}

          {currentStep === 'GOAL' && (
            <GoalStep
              goal={formData.goal}
              goalOther={formData.goalOther}
              onSelect={setGoal}
              onOtherChange={setGoalOther}
              onNext={handleNext}
            />
          )}

          {currentStep === 'HEARD' && (
            <HeardStep
              heard={formData.heardFrom}
              onSelect={setHeardFrom}
              onNext={handleNext}
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
              micPerm={formData.microphonePermission}
              cameraPerm={formData.cameraPermission}
              agreed={formData.agreedToLegal}
              loading={loading}
              isRequestingLoc={isRequestingLoc}
              isRequestingNotif={isRequestingNotif}
              isRequestingMic={isRequestingMic}
              isRequestingCamera={isRequestingCamera}
              onRequestLoc={requestLocation}
              onRequestNotif={requestNotifications}
              onRequestMic={requestMicrophone}
              onRequestCamera={requestCamera}
              onToggleAgree={() => setFormData(p => ({ ...p, agreedToLegal: !p.agreedToLegal }))}
              onFinish={handleFinish}
            />
          )}

          {currentStep === 'CONNECT' && (
            <ConnectAccountsStep
              orgId={createdOrgId}
              orgName={formData.businessName}
              email={clerkUser?.primaryEmailAddress?.emailAddress}
              onDone={finishToApp}
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
    backgroundColor: ONBOARDING.bg,
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
    width: 24,
    height: 8,
    borderRadius: 4,
    backgroundColor: ONBOARDING.dotInactive,
  },
  stepDotActive: {
    backgroundColor: ONBOARDING.green,
    width: 24,
  },
  stepContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
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
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
    letterSpacing: -2,
  },
  bigTitle: {
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
    textAlign: 'center',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: ONBOARDING.border,
    marginVertical: 16,
    minWidth: '100%',
    alignSelf: 'center',
  },
  stepTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: 'left',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: ONBOARDING.subtitle,
    textAlign: 'left',
    lineHeight: 22,
    marginTop: 6,
  },
  // Welcome (v2)
  welcomeHero: {
    height: 308,
    borderRadius: 28,
    marginTop: 4,
    padding: 16,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  welcomePhone: {
    width: 184,
    height: 258,
    borderRadius: 34,
    padding: 7,
    backgroundColor: '#1C1B17',
    shadowColor: '#1C1B17',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
  },
  welcomePhoneInner: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: '#FBFAF6',
    paddingTop: 18,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  welcomePhoneTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#1C1B17',
  },
  welcomeListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    marginTop: 9,
    borderRadius: 10,
    paddingHorizontal: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEADE',
  },
  welcomeThumb: { width: 22, height: 22, borderRadius: 7, backgroundColor: '#F1EFE6' },
  welcomeBar: { flex: 1, height: 7, marginLeft: 8, borderRadius: 3, backgroundColor: '#E7E3D6' },
  welcomeDot: { width: 6, height: 6, borderRadius: 3, marginLeft: 8, backgroundColor: '#16A34A' },
  welcomeSelSlot: { width: 14, height: 14, marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
  welcomeDotAbs: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#16A34A' },
  welcomeCheckAbs: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: {
    marginTop: 20,
    fontSize: 24,
    lineHeight: 34,
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
    letterSpacing: -0.5,
  },
  featureCard: {
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: ONBOARDING.cardBg,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
    overflow: 'hidden',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    paddingHorizontal: 14,
    gap: 13,
  },
  featureRowBorder: { borderTopWidth: 1, borderTopColor: '#EFEBDF' },
  featureIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(147,200,34,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: ONBOARDING.title },
  featureActiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#93C822' },
  featurePlayBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(147,200,34,0.18)', alignItems: 'center', justifyContent: 'center' },
  getDesktop: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: ONBOARDING.subtitle },
  signOutLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: ONBOARDING.subtitle },
  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: ONBOARDING.border,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 20,
    gap: 10,
  },
  useLocationText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.title,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.subtitle,
    marginBottom: 8,
  },
  // Buttons
  primaryButton: {
    backgroundColor: ONBOARDING.green,
    height: 54,
    borderRadius: 999,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginBottom: 0,
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  secondaryButton: {
    height: 52,
    borderRadius: 999,
    backgroundColor: '#E8E5DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#57534E',
  },
  // Selectable option rows (Sell what / Goal / Heard)
  selectList: { marginTop: 18, gap: 10 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: ONBOARDING.cardBg,
    borderWidth: 1.5,
    borderColor: ONBOARDING.border,
  },
  selectRowActive: {
    backgroundColor: 'rgba(147,200,34,0.10)',
    borderColor: ONBOARDING.green,
  },
  selectIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(147,200,34,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectLabel: {
    flex: 1,
    marginLeft: 13,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.title,
  },
  selectorBox: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  selectorUnselected: { borderWidth: 1.5, borderColor: '#D8D3C4' },
  selectorSelected: { backgroundColor: ONBOARDING.green },
  selectorDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: '#FFFFFF' },
  skipHeaderText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#8A887E' },
  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: (width - 48 - 12) / 2, // 2 columns
    height: 100,
    backgroundColor: ONBOARDING.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  cardActive: {
    backgroundColor: ONBOARDING.green,
    borderColor: ONBOARDING.green,
  },
  cardText: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.title,
    textAlign: 'center',
  },
  cardTextActive: {
    color: '#fff',
  },
  // Input
  input: {
    backgroundColor: ONBOARDING.fieldBg,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
    borderRadius: 14,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: ONBOARDING.title,
    height: 54,
    paddingHorizontal: 16,
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
    backgroundColor: ONBOARDING.cardBg,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
  },
  listCardTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
  },
  listCardDesc: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: ONBOARDING.subtitle,
    marginTop: 4,
  },
  // Phone
  phoneInputWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: ONBOARDING.border,
    backgroundColor: 'rgba(255,255,255,0.9)',
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
    color: ONBOARDING.title,
    fontSize: 20,
    fontFamily: 'Inter_500Medium',
    height: 64,
  },
  phoneCode: {
    color: ONBOARDING.title,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
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
    backgroundColor: ONBOARDING.cardBg,
    padding: 16,
    borderRadius: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
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
    fontFamily: 'Inter_700Bold',
    color: ONBOARDING.title,
    marginBottom: 2,
  },
  permDesc: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: ONBOARDING.subtitle,
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
    borderColor: ONBOARDING.subtitle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: ONBOARDING.green,
    borderColor: ONBOARDING.green,
  },
  checkboxText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: ONBOARDING.title,
  },

  // Legal Links
  linkText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.title,
    textAlign: 'center',
  },
  legalLinkSmall: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: ONBOARDING.title,
    textDecorationLine: 'underline',
  },
  // INvite List
  inviteRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  inviteInput: {
    flex: 1,
    backgroundColor: ONBOARDING.cardBg,
    borderRadius: 16,
    paddingHorizontal: 20,
    color: ONBOARDING.title,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    height: 60,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
  },
  addButton: {
    width: 60,
    height: 60,
    backgroundColor: ONBOARDING.green,
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
    backgroundColor: ONBOARDING.cardBg,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ONBOARDING.border,
  },
  inviteAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ONBOARDING.green,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  inviteInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  inviteEmail: {
    color: ONBOARDING.title,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
  },
  emptyText: {
    color: ONBOARDING.subtitle,
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  }
});
