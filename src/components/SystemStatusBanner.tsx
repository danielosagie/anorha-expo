import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSystemStatus } from '../context/SystemStatusContext';
import { useOfflineQueue } from '../context/OfflineQueueContext';

const bannerTheme = {
  operational: { backgroundColor: '#ECFDF3', borderColor: '#A7F3D0', textColor: '#166534' },
  degraded: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', textColor: '#9A3412' },
  maintenance: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D', textColor: '#92400E' },
  offline: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD', textColor: '#1D4ED8' },
};

const SystemStatusBanner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const status = useSystemStatus();
  const offlineQueue = useOfflineQueue();
  const [cardVisible, setCardVisible] = React.useState(true);
  const [countdown, setCountdown] = React.useState(60);

  if (status.effectiveMode === 'operational' && status.backendReachable !== false) {
    return null;
  }

  const theme = bannerTheme[status.effectiveMode];
  const lastHealthyCopy = status.lastHealthyAt
    ? `Last healthy check ${new Date(status.lastHealthyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Retry once services are back.';
  const capabilityRows = [
    {
      title: 'Inventory and product edits',
      body: 'Quantities, prices, titles, descriptions, and draft changes can queue locally.',
      color: '#1D4ED8',
    },
    {
      title: 'Import prep',
      body: 'File selection and column mapping can be staged locally until upload resumes.',
      color: '#0F766E',
    },
    {
      title: 'Scanning capture only',
      body: 'Photo capture can still happen, but AI matching and OCR should wait for connectivity.',
      color: '#9A3412',
    },
  ];

  React.useEffect(() => {
    setCardVisible(true);
  }, [status.effectiveMode]);

  React.useEffect(() => {
    setCountdown(60);
    const interval = setInterval(() => {
      setCountdown((current) => current <= 1 ? 60 : current - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [status.lastCheckedAt]);

  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 0,
          right: 0,
          zIndex: 30,
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => setCardVisible((current) => !current)}
          style={{
            paddingHorizontal: 18,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: '#F59E0B',
            shadowColor: '#9A3412',
            shadowOpacity: 0.16,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          }}
        >
          <Text
            style={{
              fontFamily: 'PlusJakartaSans_700Bold',
              color: '#FFFFFF',
              fontSize: 13,
            }}
          >
            Offline
          </Text>
        </Pressable>
      </View>
      {cardVisible ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 25,
            paddingHorizontal: 12,
            paddingBottom: Math.max(insets.bottom, 12),
          }}
        >
          <View
            style={{
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderBottomLeftRadius: 24,
              borderBottomRightRadius: 24,
              backgroundColor: '#FFF9F2',
              paddingHorizontal: 18,
              paddingTop: 14,
              paddingBottom: 18,
              borderWidth: 1,
              borderColor: 'rgba(245, 158, 11, 0.12)',
              shadowColor: '#7C2D12',
              shadowOpacity: 0.08,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: -4 },
              elevation: 12,
            }}
          >
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <View
                style={{
                  width: 42,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: 'rgba(120, 113, 108, 0.35)',
                }}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 20,
                  color: '#1C1917',
                }}
              >
                Server Status
              </Text>
              <Pressable onPress={() => setCardVisible(false)}>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: '#A8A29E',
                    fontSize: 18,
                  }}
                >
                  ×
                </Text>
              </Pressable>
            </View>
            <View
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: '#FFF1DC',
                marginBottom: 18,
              }}
            >
              <Text
                style={{
                  fontFamily: 'PlusJakartaSans_700Bold',
                  color: '#D97706',
                  fontSize: 12,
                }}
              >
                Rechecking in {countdown}s
              </Text>
            </View>
            <Text
              style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                color: '#78716C',
                fontSize: 14,
                marginBottom: 10,
              }}
            >
              What&apos;s happening
            </Text>
            <View
              style={{
                borderRadius: 20,
                backgroundColor: '#FFFFFF',
                padding: 14,
                gap: 14,
              }}
            >
              <View>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: theme.textColor,
                    fontSize: 15,
                    marginBottom: 4,
                  }}
                >
                  Services degraded
                </Text>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    color: '#78716C',
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {status.message || lastHealthyCopy}
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: '#15803D',
                    fontSize: 15,
                    marginBottom: 4,
                  }}
                >
                  Your data is safe
                </Text>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    color: '#78716C',
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  Changes that support offline queueing stay on this device until sync completes.
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: '#0284C7',
                    fontSize: 15,
                    marginBottom: 4,
                  }}
                >
                  Automatic sync
                </Text>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    color: '#78716C',
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  Queued changes can sync automatically the next time the app reaches the backend.
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: '#C026D3',
                    fontSize: 15,
                    marginBottom: 4,
                  }}
                >
                  Pending changes
                </Text>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_500Medium',
                    color: '#78716C',
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {offlineQueue.pendingCount} item{offlineQueue.pendingCount === 1 ? '' : 's'} waiting to sync.
                </Text>
              </View>
            </View>
            <Text
              style={{
                fontFamily: 'PlusJakartaSans_700Bold',
                color: '#78716C',
                fontSize: 14,
                marginTop: 16,
                marginBottom: 10,
              }}
            >
              What still works
            </Text>
            <View style={{ gap: 10 }}>
              {capabilityRows.map((row) => (
                <View
                  key={row.title}
                  style={{
                    borderRadius: 18,
                    backgroundColor: '#FFFFFF',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'PlusJakartaSans_700Bold',
                      color: row.color,
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    {row.title}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'PlusJakartaSans_500Medium',
                      color: '#78716C',
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    {row.body}
                  </Text>
                </View>
              ))}
            </View>
            <View
              style={{
                marginTop: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text
                style={{
                  fontFamily: 'PlusJakartaSans_500Medium',
                  color: '#78716C',
                  fontSize: 12,
                }}
              >
                {status.usingCachedStatus ? 'Showing cached service state' : lastHealthyCopy}
              </Text>
              <Pressable onPress={() => { void status.retry(); }}>
                <Text
                  style={{
                    fontFamily: 'PlusJakartaSans_700Bold',
                    color: '#D97706',
                    fontSize: 13,
                  }}
                >
                  Retry now
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
};

export default SystemStatusBanner;
