import React, { useState, useContext, useRef, createRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import { supabase } from '../../lib/supabase';
import { AuthContext } from '../context/AuthContext';
import { useNavigation, RouteProp, useRoute } from '@react-navigation/native';
import PhoneInput from 'react-native-phone-number-input';

// Define type for navigation parameters
type PhoneAuthScreenRouteParams = {
  phoneNumber: string;
};

// Define type for the route prop
type PhoneAuthScreenRouteProp = RouteProp<{ Params: PhoneAuthScreenRouteParams }, 'Params'>;

const PhoneAuthScreen = () => {
  const route = useRoute<PhoneAuthScreenRouteProp>(); // Get route params
  const passedPhoneNumber = route.params?.phoneNumber; // Get the phone number passed from AuthScreen

  const [phoneNumber, setPhoneNumber] = useState('');
  const [formattedValue, setFormattedValue] = useState(passedPhoneNumber || '');
  const [countryCode, setCountryCode] = useState('US');
  const [otp, setOtp] = useState(Array(6).fill(''));
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [focusedOtpIndex, setFocusedOtpIndex] = useState<number | null>(null);
  const authContext = useContext(AuthContext);
  const navigation = useNavigation();
  const phoneInputRef = useRef<PhoneInput>(null);

  // Refs for OTP inputs
  const otpInputRefs = useRef<Array<React.RefObject<TextInput>>>([]);
  otpInputRefs.current = Array(6).fill(0).map((_, i) => otpInputRefs.current[i] ?? createRef<TextInput>());

  // Effect to set state from params when component mounts
  useEffect(() => {
    if (passedPhoneNumber) {
      setFormattedValue(passedPhoneNumber);
      // Optionally try to parse the number to set the input field and country code
      // This depends on whether the phone input library can parse E.164 directly
      // For simplicity, we might just disable the input if number is passed
    }
  }, [passedPhoneNumber]);

  const handleSendOtp = async () => {
    const checkValid = phoneInputRef.current?.isValidNumber(phoneNumber);
    if (!checkValid) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }
    if (!formattedValue) {
      Alert.alert('Error', 'Could not format phone number.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedValue,
      });

      if (error) throw error;

      setOtpSent(true);
      Alert.alert('Success', 'OTP sent to your phone!');
      setOtp(Array(6).fill(''));
      setTimeout(() => otpInputRefs.current[0]?.current?.focus(), 100);
    } catch (error: any) {
      console.error('OTP Send Error:', error);
      Alert.alert('Error', error.message || 'Failed to send OTP');
      setOtpSent(false);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      Alert.alert('Error', 'Please enter the complete 6-digit OTP');
      return;
    }
    if (!authContext) {
      Alert.alert('Error', 'Auth context unavailable.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: formattedValue,
        token: otpString,
        type: 'sms',
      });

      if (error) throw error;

      if (data.session) {
        console.log('Phone Sign-In/Verification Success:', data.session.user.phone);
        // --- Navigate to CreateAccountScreen on successful verification --- //
        // Make sure user is fully authenticated if needed by CreateAccountScreen
        // If CreateAccountScreen relies on AuthContext, ensure it's updated
        // authContext.signIn(data.session.access_token); // Or let the listener handle it

        navigation.navigate('CreateAccountScreen'); // Navigate to the onboarding/profile setup
        // ------------------------------------------------------------------ //
      } else {
        throw new Error('OTP verification successful but no session received.');
      }
    } catch (error: any) {
      console.error('OTP Verify Error:', error);
      Alert.alert('Error', error.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  // Function to handle OTP input changes and focus management
  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = text.replace(/[^0-9]/g, '').slice(-1);
    setOtp(newOtp);

    if (text && index < 5) {
      otpInputRefs.current[index + 1]?.current?.focus();
    } else if (text && index === 5) {
    }
  };

  // Function to handle backspace/delete
  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      const newOtp = [...otp];
      if (!newOtp[index] && index > 0) {
        otpInputRefs.current[index - 1]?.current?.focus();
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <AnimatedGradientBackground />
      <View style={styles.formContainer}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.headerText}>
          {otpSent ? 'Enter OTP' : 'Sign In with Phone'}
        </Text>

        {!otpSent ? (
          <>
            <PhoneInput
              ref={phoneInputRef}
              defaultValue={phoneNumber}
              defaultCode={countryCode as any}
              layout="first"
              onChangeText={(text: string) => {
                setPhoneNumber(text);
              }}
              onChangeFormattedText={(text: string) => {
                setFormattedValue(text);
              }}
              onChangeCountry={(country: any) => setCountryCode(country.cca2)}
              withDarkTheme={false}
              withShadow
              autoFocus={false}
              containerStyle={styles.phoneContainer}
              textContainerStyle={styles.phoneTextContainer}
              textInputStyle={styles.phoneTextInput}
              codeTextStyle={styles.phoneCodeText}
              countryPickerButtonStyle={styles.phoneCountryPickerButton}
              disabled={!!passedPhoneNumber}
              textInputProps={{
                placeholder: passedPhoneNumber ? passedPhoneNumber : "Phone Number"
              }}
            />
            <Button
              title="Send OTP"
              onPress={handleSendOtp}
              style={styles.button}
              textStyle={styles.buttonText}
              loading={loading}
            />
          </>
        ) : (
          <>
            <View style={styles.otpContainer}>
              {otp.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={otpInputRefs.current[index]}
                  style={[
                    styles.otpInput,
                    focusedOtpIndex === index && styles.otpInputFocused
                  ]}
                  placeholder="-"
                  placeholderTextColor="#ccc"
                  keyboardType="number-pad"
                  value={digit}
                  onChangeText={(text) => handleOtpChange(text, index)}
                  onKeyPress={(e) => handleOtpKeyPress(e, index)}
                  onFocus={() => setFocusedOtpIndex(index)}
                  onBlur={() => setFocusedOtpIndex(null)}
                  maxLength={1}
                  selectTextOnFocus
                  textAlign="center"
                />
              ))}
            </View>
            <Button
              title="Verify OTP & Sign In"
              onPress={handleVerifyOtp}
              style={styles.button}
              textStyle={styles.buttonText}
              loading={loading}
            />
            <TouchableOpacity onPress={handleSendOtp} disabled={loading}>
              <Text style={styles.resendText}>Resend OTP</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  formContainer: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    top: 15,
    left: 15,
    zIndex: 1,
  },
  backButtonText: {
    color: '#5c9c00',
    fontSize: 16,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    marginTop: 30,
    color: '#333',
    textAlign: 'center'
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 16,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#5c9c00',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 25,
    marginTop: 10,
  },
  otpInput: {
    width: 45,
    height: 55,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#333',
    backgroundColor: '#f0f0f0',
  },
  otpInputFocused: {
    borderColor: '#5c9c00',
    backgroundColor: '#fff',
  },
  phoneContainer: {
    width: '100%',
    height: 56,
    marginBottom: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  phoneTextContainer: {
    backgroundColor: 'transparent',
    paddingVertical: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  phoneTextInput: {
    height: 54,
    fontSize: 16,
    color: '#333',
  },
  phoneCodeText: {
    fontSize: 16,
    color: '#555',
  },
  phoneCountryPickerButton: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    justifyContent: 'center',
    backgroundColor: '#e5e5e5',
    marginRight: 5,
    borderRightWidth: 1,
    borderRightColor: '#d0d0d0',
  },
  resendText: {
    color: '#5c9c00',
    fontSize: 14,
    marginTop: 8,
  },
});

export default PhoneAuthScreen; 