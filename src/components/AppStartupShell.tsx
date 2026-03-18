import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

type AppStartupShellProps = {
  title: string;
  message: string;
  accent?: string;
};

const AppStartupShell: React.FC<AppStartupShellProps> = ({
  title,
  message,
  accent = '#0F766E',
}) => {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        backgroundColor: '#F7F7F2',
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 420,
          paddingHorizontal: 24,
          paddingVertical: 28,
          borderRadius: 28,
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: 'rgba(15, 118, 110, 0.14)',
          shadowColor: '#0B1F1C',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 6,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: 'rgba(15, 118, 110, 0.10)',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <ActivityIndicator color={accent} />
        </View>
        <Text
          style={{
            fontFamily: 'PlusJakartaSans_700Bold',
            fontSize: 24,
            color: '#13201C',
            marginBottom: 10,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: 'PlusJakartaSans_500Medium',
            fontSize: 15,
            lineHeight: 22,
            color: '#51615C',
          }}
        >
          {message}
        </Text>
      </View>
    </View>
  );
};

export default AppStartupShell;
