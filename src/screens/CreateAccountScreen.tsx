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
  ScrollView
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import { supabase } from '../../lib/supabase';
import { AuthContext } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Image } from 'react-native'; // Added for logo
import { StackNavigationProp } from '@react-navigation/stack';

// Assuming AppStackParamList is defined in AppNavigator or a types file
// If not, you might need to define it here or import it.
type AppStackParamList = {
  CreateAccountScreen: undefined;
  TabNavigator: undefined;
  ProductDetail: { productId: string };
};

// Define navigation prop type for this screen
type CreateAccountScreenNavigationProp = StackNavigationProp<AppStackParamList, 'CreateAccountScreen'>;

// Define types for picker items (DropDownPicker uses label/value by default)
// Removed PickerItem interface

const CreateAccountScreen = () => {
  const [businessName, setBusinessName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [occupation, setOccupation] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // State for dropdown open status
  const [openRegion, setOpenRegion] = useState(false);
  const [openCurrency, setOpenCurrency] = useState(false);

  const authContext = useContext(AuthContext);
  const navigation = useNavigation<CreateAccountScreenNavigationProp>();

  // Items for DropDownPicker (Type inferred)
  const [regionItems, setRegionItems] = useState([
    { label: 'United States', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'Europe', value: 'EU' },
    { label: 'Other', value: 'Other' },
  ]);

  // Type inferred
  const [currencyItems, setCurrencyItems] = useState([
    { label: 'USD ($)', value: 'USD' },
    { label: 'CAD (C$)', value: 'CAD' },
    { label: 'EUR (€)', value: 'EUR' },
    { label: 'GBP (£)', value: 'GBP' },
  ]);

  const handleCompleteProfile = async () => {
    // Updated validation check
    if (!businessName || !phoneNumber || !region || !occupation || !currency) {
      Alert.alert('Error', 'Please fill out all fields.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        throw userError || new Error("User not found. Please log in again.");
      }

      // --- Combine Users table updates into one call --- //
      const { error: userUpdateError } = await supabase
        .from('Users')
        .update({ // Use UPDATE, not upsert. Assume user record exists.
          // Only include fields from this screen + onboarding flag
          PhoneNumber: phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber}`, // Basic formatting
          Region: region,
          Occupation: occupation,
          Currency: currency,
          isOnboardingComplete: true // Set onboarding complete here
          // DO NOT include Email, FirstName, LastName - let them persist from signup
        })
        .eq('Id', user.id); // Target the correct user

      if (userUpdateError) {
        // Check if the error is because the user doesn't exist (though unlikely after getUser)
        if (userUpdateError.code === 'PGRST204') { // PostgREST code for no rows found
           console.error("User record not found for update, attempting upsert as fallback...");
            // Optional Fallback: Attempt an upsert if update failed because row missing
            // This requires including potentially required fields like Email
            const { error: fallbackUpsertError } = await supabase.from('Users').upsert({ 
                Id: user.id,
                Email: user.email!, // Need email for potential insert
                PhoneNumber: phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber}`,
                Region: region,
                Occupation: occupation,
                Currency: currency,
                isOnboardingComplete: true 
            }, { onConflict: 'Id' });
            if (fallbackUpsertError) throw fallbackUpsertError; // Throw if fallback fails too
        } else {
             throw userUpdateError; // Throw other update errors
        }
      }

      // --- Upsert UserProfiles table (Keep as is) --- //
      const { error: profilesUpsertError } = await supabase
        .from('UserProfiles')
        .upsert({ 
          UserId: user.id,
          DisplayName: businessName,
          // Add other UserProfile fields if needed
        }, { onConflict: 'UserId' });

      if (profilesUpsertError) throw profilesUpsertError;

      Alert.alert('Success', 'Profile setup complete!');

      // Navigate to the main app (TabNavigator inside AppStack) and reset history
      navigation.reset({
        index: 0,
        routes: [{ name: 'TabNavigator' }], // Directly target screen within the *same* stack
      });

    } catch (error: any) {
      console.error("Onboarding save error:", error);
      Alert.alert('Error', error.message || 'Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <AnimatedGradientBackground />
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.logoContainer}>
            <Image source={require('../assets/rounded_sssync.png')} style={styles.logo} />
            <Text style={styles.title}>sssync</Text>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.headerText}>Tell us about your business</Text>
            <Text style={styles.subHeaderText}>Let's get to know you some more</Text>

            {/* Business Name */}
            <Text style={styles.label}>Business Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your Business LLC"
              placeholderTextColor="#aaa"
              value={businessName}
              onChangeText={setBusinessName}
            />
            <Text style={styles.inputHint}>What you will be called on the app</Text>

            {/* Phone Number - Consider if needed if already verified */}
            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.phoneInputContainer}>
              {/* Basic Country Code - enhance later if needed */}
              <View style={styles.countryCodeContainer}>
                 <Text style={styles.countryCodeText}>+1</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder="Enter a phone number"
                placeholderTextColor="#aaa"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
            </View>

            {/* Region Picker using DropDownPicker */}
            <Text style={styles.label}>Region</Text>
            <DropDownPicker
              open={openRegion}
              value={region}
              items={regionItems}
              setOpen={setOpenRegion}
              setValue={setRegion}
              setItems={setRegionItems}
              placeholder="Select your region..."
              containerStyle={styles.dropdownContainer}
              style={styles.dropdownStyle}
              dropDownContainerStyle={styles.dropdownListStyle}
              placeholderStyle={styles.placeholderStyle}
              textStyle={styles.dropdownTextStyle}
              labelStyle={styles.dropdownLabelStyle}
              listItemLabelStyle={styles.dropdownListItemLabelStyle}
              zIndex={3000}
              zIndexInverse={1000}
              maxHeight={150}
              onOpen={() => setOpenCurrency(false)}
            />
            <Text style={styles.inputHint}>Which region are you selling in</Text>

            {/* Occupation Input */}
            <Text style={styles.label}>Occupation / Role</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Seller, Artist, Shop Owner"
              placeholderTextColor="#aaa"
              value={occupation}
              onChangeText={setOccupation}
            />
            <Text style={styles.inputHint}>Describe your primary role</Text>

            {/* Currency Picker using DropDownPicker */}
            <Text style={styles.label}>Default Currency</Text>
            <DropDownPicker
              open={openCurrency}
              value={currency}
              items={currencyItems}
              setOpen={setOpenCurrency}
              setValue={setCurrency}
              setItems={setCurrencyItems}
              placeholder="Select your currency..."
              containerStyle={styles.dropdownContainer}
              style={styles.dropdownStyle}
              dropDownContainerStyle={styles.dropdownListStyle}
              placeholderStyle={styles.placeholderStyle}
              textStyle={styles.dropdownTextStyle}
              labelStyle={styles.dropdownLabelStyle}
              listItemLabelStyle={styles.dropdownListItemLabelStyle}
              zIndex={2000}
              zIndexInverse={2000}
              maxHeight={150}
              onOpen={() => setOpenRegion(false)}
            />
            <Text style={styles.inputHint}>Primary currency for your transactions</Text>

            <Button
              title="Continue"
              onPress={handleCompleteProfile}
              style={styles.button}
              textStyle={styles.buttonText}
              loading={loading}
            />
          </View>
        </ScrollView>
    </KeyboardAvoidingView>
  );
};

// --- Styles --- (Combine/adapt from AuthScreen/PhoneAuthScreen)
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 40, // Add some top margin
  },
  logo: {
    width: 60, // Slightly smaller logo for onboarding
    height: 60,
    borderRadius: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  formContainer: {
    width: '100%',
    maxWidth: 400, // Max width for larger screens
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 25,
    alignItems: 'stretch', // Align items to stretch horizontally
  },
  headerText: {
    fontSize: 26, // Larger header
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#222',
    textAlign: 'center',
  },
  subHeaderText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
    marginLeft: 4, // Small indent
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 4,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 4,
  },
  countryCodeContainer: {
      height: 50,
      backgroundColor: '#e5e5e5',
      borderRadius: 8,
      paddingHorizontal: 15,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
       borderWidth: 1,
      borderColor: '#d0d0d0',
  },
  countryCodeText: {
      fontSize: 16,
      color: '#555',
  },
  phoneInput: {
    flex: 1,
    marginBottom: 0, // Remove margin as it's handled by container
    width: undefined, // Allow flex to determine width
  },
  pickerContainer: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 4,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingHorizontal: 10, // Add padding for picker text
  },
   inputHint: {
    fontSize: 12,
    color: '#888',
    marginBottom: 20,
    marginLeft: 4,
  },
  button: {
    width: '100%',
    backgroundColor: '#4a7d00', // Darker green from design
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20, // Add margin above button
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  dropdownContainer: {
    marginBottom: 20,
    zIndex: 1,
  },
  dropdownStyle: {
    backgroundColor: '#f0f0f0',
    borderColor: '#e0e0e0',
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  dropdownListStyle: {
    backgroundColor: '#ffffff',
    borderColor: '#cccccc',
    borderWidth: 1,
    borderRadius: 8,
  },
  placeholderStyle: {
    color: "#aaa",
    fontSize: 16,
  },
  dropdownTextStyle: {
    fontSize: 16,
    color: '#333',
  },
  dropdownLabelStyle: {
  },
  dropdownListItemLabelStyle: {
    fontSize: 16,
    color: '#333',
  },
});

// Styles for RNPickerSelect
const pickerSelectStyles = StyleSheet.create({
  inputIOS: {
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    color: 'black',
    paddingRight: 30, // to ensure the text is never behind the icon
  },
  inputAndroid: {
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: 'black',
    paddingRight: 30, // to ensure the text is never behind the icon
  },
  placeholder: {
    color: '#aaa',
  },
  iconContainer: {
    top: 15,
    right: 15,
  },
});

export default CreateAccountScreen;
