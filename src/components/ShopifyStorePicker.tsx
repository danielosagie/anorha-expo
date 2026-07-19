import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView,
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { BRAND_PRIMARY } from "../design/tokens";
import { extractShopifyStoreHandle } from "../utils/shopifyStore";

const SHOPIFY_ADMIN_URL = "https://admin.shopify.com";
const LOCATION_WATCHER = `
  (function () {
    function sendLocation() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'location', url: window.location.href }));
    }
    var pushState = history.pushState;
    var replaceState = history.replaceState;
    history.pushState = function () { pushState.apply(history, arguments); sendLocation(); };
    history.replaceState = function () { replaceState.apply(history, arguments); sendLocation(); };
    window.addEventListener('popstate', sendLocation);
    window.addEventListener('hashchange', sendLocation);
    sendLocation();
  })();
  true;
`;

interface Props {
  visible: boolean;
  onStore: (handle: string) => void;
  onCancel: () => void;
}

export default function ShopifyStorePicker({
  visible,
  onStore,
  onCancel,
}: Props) {
  const insets = useSafeAreaInsets();
  const detectedRef = useRef(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const resolvedHandle = useMemo(
    () => extractShopifyStoreHandle(input),
    [input],
  );

  useEffect(() => {
    if (!visible) return;
    detectedRef.current = false;
    setManualOpen(false);
    setInput("");
    setLoaded(false);
  }, [visible]);

  useEffect(() => {
    if (!manualOpen) return;
    let active = true;
    Clipboard.getStringAsync()
      .then((clipboardValue) => {
        if (active && extractShopifyStoreHandle(clipboardValue))
          setInput(clipboardValue.trim());
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [manualOpen]);

  const detectStore = useCallback(
    (url?: string | null) => {
      if (!url || detectedRef.current) return;
      const handle = extractShopifyStoreHandle(url);
      if (!handle) return;
      detectedRef.current = true;
      onStore(handle);
    },
    [onStore],
  );

  const handleNavigation = useCallback(
    (navigation: WebViewNavigation) => detectStore(navigation.url),
    [detectStore],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          url?: string;
        };
        if (message.type === "location") detectStore(message.url);
      } catch {
        detectStore(event.nativeEvent.data);
      }
    },
    [detectStore],
  );

  const confirmManual = useCallback(() => {
    if (!resolvedHandle || detectedRef.current) return;
    detectedRef.current = true;
    onStore(resolvedHandle);
  }, [onStore, resolvedHandle]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={onCancel}
      >
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable
              style={styles.iconButton}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Icon name="close" size={20} color="#52525B" />
            </Pressable>
            <Text style={styles.title}>Choose store</Text>
            <Pressable
              style={styles.manualButton}
              onPress={() => setManualOpen(true)}
              accessibilityRole="button"
            >
              <Text style={styles.manualButtonText}>Enter store</Text>
            </Pressable>
          </View>

          {!loaded ? (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color={BRAND_PRIMARY} />
              <Text style={styles.loadingText}>Opening Shopify</Text>
            </View>
          ) : null}

          <WebView
            source={{ uri: SHOPIFY_ADMIN_URL }}
            style={styles.webView}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            javaScriptEnabled
            injectedJavaScript={LOCATION_WATCHER}
            onLoadEnd={() => setLoaded(true)}
            onNavigationStateChange={handleNavigation}
            onShouldStartLoadWithRequest={(request) => {
              detectStore(request.url);
              return true;
            }}
            onMessage={handleMessage}
            startInLoadingState={false}
          />
        </View>
      </Modal>

      <Modal
        visible={visible && manualOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setManualOpen(false)}
      >
        <View style={styles.fallbackOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setManualOpen(false)}
          />
          <View
            style={[
              styles.fallbackSheet,
              { paddingBottom: Math.max(insets.bottom, 16) + 8 },
            ]}
          >
            <View style={styles.grabber} />
            <View style={styles.fallbackHeader}>
              <Text style={styles.fallbackTitle}>Enter store</Text>
              <Pressable
                style={styles.iconButton}
                onPress={() => setManualOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Icon name="close" size={18} color="#71717A" />
              </Pressable>
            </View>
            <Text style={styles.fallbackSubtitle}>
              Paste a Shopify URL or store name.
            </Text>
            <View
              style={[
                styles.inputWrap,
                input.length > 0 &&
                  (resolvedHandle ? styles.inputValid : styles.inputInvalid),
              ]}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="your-store.myshopify.com"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
                accessibilityLabel="Shopify store"
              />
              <Pressable
                style={styles.pasteButton}
                onPress={async () =>
                  setInput((await Clipboard.getStringAsync()).trim())
                }
                accessibilityRole="button"
                accessibilityLabel="Paste"
              >
                <Icon name="content-paste" size={19} color="#5D7E16" />
              </Pressable>
            </View>

            {resolvedHandle ? (
              <View style={styles.resolvedRow}>
                <Icon name="check-circle" size={18} color="#5D7E16" />
                <Text style={styles.resolvedText}>{resolvedHandle}</Text>
              </View>
            ) : input.length > 0 ? (
              <Text style={styles.invalidText}>Check the store name</Text>
            ) : null}

            <Pressable
              style={[
                styles.connectButton,
                !resolvedHandle && styles.connectButtonDisabled,
              ]}
              onPress={confirmManual}
              disabled={!resolvedHandle}
              accessibilityRole="button"
              accessibilityLabel="Connect store"
            >
              <Text style={styles.connectButtonText}>Connect store</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F4F1" },
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F4F1",
  },
  title: {
    flex: 1,
    marginLeft: 12,
    fontSize: 17,
    fontWeight: "700",
    color: "#18181B",
  },
  manualButton: { minHeight: 44, justifyContent: "center", paddingLeft: 14 },
  manualButtonText: { fontSize: 14, fontWeight: "700", color: "#5D7E16" },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    top: 56,
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#F4F4F1",
  },
  loadingText: { fontSize: 14, fontWeight: "600", color: "#71717A" },
  fallbackOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(24,24,27,0.42)",
  },
  fallbackSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#FFFFFF",
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginBottom: 12,
  },
  fallbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fallbackTitle: { fontSize: 19, fontWeight: "700", color: "#18181B" },
  fallbackSubtitle: {
    marginTop: 2,
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 20,
    color: "#71717A",
  },
  inputWrap: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  inputValid: { borderColor: "#93C822" },
  inputInvalid: { borderColor: "#DC2626" },
  input: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#18181B",
  },
  pasteButton: {
    width: 48,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  resolvedRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resolvedText: { fontSize: 14, fontWeight: "700", color: "#3F3F46" },
  invalidText: { minHeight: 38, paddingTop: 9, fontSize: 13, color: "#DC2626" },
  connectButton: {
    minHeight: 52,
    marginTop: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND_PRIMARY,
  },
  connectButtonDisabled: { opacity: 0.45 },
  connectButtonText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
