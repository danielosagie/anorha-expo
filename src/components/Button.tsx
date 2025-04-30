import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
        <ActivityIndicator color="white" />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color="white" style={styles.icon} />}
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
    backgroundColor: '#8cc63f',
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlinedButton: {
    backgroundColor: 'gray',
    borderWidth: 1,
    borderColor: 'white',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  outlinedButtonText: {
    color: 'white',
  },
  disabledButton: {
    opacity: 0.6,
  },
  icon: {
    marginRight: 8,
  }
});

export default Button; 