# 🔄 Quick Rollback Instructions

If you're experiencing a white screen or crashes after implementing the process persistence system, here are quick fixes:

## Option 1: Disable New Features (Recommended)

**In App.tsx, change line 26:**
```typescript
// FROM:
const ENABLE_PROCESS_FEATURES = true;

// TO:
const ENABLE_PROCESS_FEATURES = false;
```

This will disable all new process features while keeping the improved auth system.

## Option 2: Use Original SessionProvider

**In App.tsx, change lines 18-19:**
```typescript
// FROM:
import { EnhancedSessionProvider } from './src/context/EnhancedSessionProvider';

// TO:
import { SessionProvider } from './src/context/SessionProvider';
```

**And change line 165:**
```typescript
// FROM:
<EnhancedSessionProvider getClerkToken={() => getToken({ template }).catch(async () => getToken())}>

// TO:
<SessionProvider getClerkToken={() => getToken({ template }).catch(async () => getToken())}>
```

## Option 3: Clean Cache & Restart

1. **Stop the Expo dev server**
2. **Clear cache:**
   ```bash
   npx expo start --clear
   ```
3. **Force close Expo Go app** completely
4. **Restart Expo Go** and reload your app

## Option 4: Reset Storage

**If persistent state is causing issues, add this to your App.tsx temporarily:**

```typescript
// Add at top of App component
useEffect(() => {
  const clearStorage = async () => {
    try {
      await AsyncStorage.clear();
      console.log('Storage cleared');
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  };
  
  // Uncomment next line to clear storage on app start
  // clearStorage();
}, []);
```

## Debugging Steps

1. **Check console logs** in Expo CLI for error messages
2. **Try Option 1 first** (disable features)
3. **If still white screen, try Option 2** (revert to original provider)
4. **If still issues, try Option 3** (clear cache)
5. **Last resort: Option 4** (reset storage)

## Common Issues & Fixes

### White Screen on Startup
- Usually caused by JavaScript error during render
- Try disabling features with Option 1
- Check console for specific error messages

### App Crashes During Navigation
- Likely process resumption modal issue
- Set `ENABLE_PROCESS_FEATURES = false`

### Infinite Loading
- Could be auth persistence issue
- Revert to original SessionProvider (Option 2)

### Storage Corruption
- Clear AsyncStorage with Option 4
- Restart app completely

## If All Else Fails

Create a simple test to isolate the issue:

**Create `src/components/SimpleTest.tsx`:**
```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SimpleTest = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>App is working!</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 24, fontWeight: 'bold' },
});

export default SimpleTest;
```

**Replace AppNavigator temporarily in App.tsx:**
```typescript
// Replace <AppNavigator /> with:
<SimpleTest />
```

If this works, the issue is in the navigation/component level, not the core app structure.

## Success Test

Once you get the app working again:
1. You should see the login/auth flow working
2. The app should start faster than before (from auth caching)
3. Auth should only validate every 30 minutes instead of constantly

The core improvements (faster auth, persistent state) should still work even with `ENABLE_PROCESS_FEATURES = false`.
