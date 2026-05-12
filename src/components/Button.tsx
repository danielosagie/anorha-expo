import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const ANORHA_GREEN = '#8cc63f';
const NEUTRAL_GRAY_BG = '#E5E7EB';
const NEUTRAL_GRAY_TEXT = '#111827';

interface ButtonProps {
  title: string;
  onPress: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  outlined?: boolean;
}

const Button = ({ 
  title, 
  onPress, 
  style, 
  textStyle, 
  loading = false, 
  disabled = false,
  icon,
  outlined = false
}: ButtonProps) => {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        outlined && styles.outlinedButton,
        style,
        disabled && styles.disabledButton
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={outlined ? NEUTRAL_GRAY_TEXT : 'white'} />
      ) : (
        <>
          {icon && (
            <Icon
              name={icon}
              size={20}
              color={outlined ? NEUTRAL_GRAY_TEXT : 'white'}
              style={styles.icon}
            />
          )}
          <Text style={[
            styles.buttonText,
            outlined && styles.outlinedButtonText,
            textStyle
          ]}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    backgroundColor: ANORHA_GREEN,
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlinedButton: {
    backgroundColor: NEUTRAL_GRAY_BG,
    borderWidth: 1,
    borderColor: NEUTRAL_GRAY_BG,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  outlinedButtonText: {
    color: NEUTRAL_GRAY_TEXT,
  },
  disabledButton: {
    opacity: 0.6,
  },
  icon: {
    marginRight: 8,
  }
});

export default Button; 