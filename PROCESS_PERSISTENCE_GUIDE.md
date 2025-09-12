# 🔄 Process Persistence System

A comprehensive solution for maintaining app state and ongoing processes across app restarts, crashes, and interruptions.

## ✅ Problems Solved

1. **❌ Before**: App restarts completely lose all progress
   **✅ After**: Seamless resumption of ongoing workflows

2. **❌ Before**: Users forced to start over after interruptions  
   **✅ After**: Smart recovery from exactly where they left off

3. **❌ Before**: Long uploads/processes lost on phone calls
   **✅ After**: Background-safe process handling

4. **❌ Before**: Frequent auth checks disrupting UX
   **✅ After**: 30-minute validation intervals with auto-retry

## 🏗️ Architecture

### Core Components

```typescript
// 1. Process Types
enum ProcessType {
  AI_GENERATION = 'AI_GENERATION',
  LISTING_CREATION = 'LISTING_CREATION', 
  PHOTO_UPLOAD = 'PHOTO_UPLOAD',
  PRODUCT_MATCHING = 'PRODUCT_MATCHING',
}

// 2. Process Status
enum ProcessStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
```

### Storage Strategy

- **Auth State**: AsyncStorage (fast access) + SecureStore (sensitive tokens)
- **Process Data**: AsyncStorage with user-scoped keys
- **Persistence**: Automatic background saving on every state change

## 🚀 How to Use

### 1. Basic Process Creation

```typescript
import { useProcessPersistence } from '../utils/ProcessHelpers';
import { useProcessState } from '../hooks/useProcessState';

const MyScreen = () => {
  const { createListingProcess, updateListingStage } = useProcessPersistence();
  const [processId, setProcessId] = useState<string | null>(null);
  const { process } = useProcessState(processId);

  const startProcess = async () => {
    const id = await createListingProcess(userId, {
      images: [],
      selectedPlatforms: ['shopify'],
      listingStage: 'PLATFORM_SELECTION',
    });
    setProcessId(id);
  };
};
```

### 2. Progress Updates

```typescript
// Update stage and progress
await updateListingStage(processId, 'ANALYZING', 25, {
  analysisResults: data,
  timestamp: Date.now(),
});

// Update just progress
await updateProgress(50, 'GENERATING');

// Update data
await updateData({ generatedDetails: results });
```

### 3. Process Resumption

```typescript
// In your screen component
const resumeProcessId = route.params?.resumeProcessId;

useEffect(() => {
  if (resumeProcessId) {
    const processData = getProcessData(resumeProcessId);
    if (processData) {
      // Restore your component state from processData
      setCurrentStage(processData.listingStage);
      setImages(processData.images);
      // Continue from where user left off
    }
  }
}, [resumeProcessId]);
```

### 4. Error Handling

```typescript
try {
  await performLongTask();
  await completeProcess(processId);
} catch (error) {
  await failProcess(processId, error.message);
  // Show user-friendly error
}
```

### 5. Background Handling

```typescript
useEffect(() => {
  const handleAppStateChange = (nextAppState) => {
    if (processId && isProcessing) {
      if (nextAppState === 'background') {
        pauseProcess(processId);
      } else if (nextAppState === 'active') {
        resumeProcess(processId);
      }
    }
  };

  AppState.addEventListener('change', handleAppStateChange);
  return () => AppState.removeEventListener('change', handleAppStateChange);
}, [processId, isProcessing]);
```

## 📱 User Experience Flow

### App Startup
1. ⚡ **Instant Load**: UI appears immediately from cached auth state
2. 🔍 **Background Validation**: Auth validated quietly in background
3. 📋 **Process Discovery**: Check for resumable processes
4. 🎯 **Smart Prompts**: Show resumption modal if processes found

### During Processes  
1. 📊 **Real-time Progress**: Live updates saved automatically
2. 🔄 **Interruption Safe**: Handles calls, backgrounding, crashes
3. 🎯 **Smart Recovery**: Resumes exactly where user left off
4. ⚠️ **Error Resilience**: Graceful failure handling

### Session Management
1. ⏰ **30-min Validation**: Much less frequent than before (was 2 seconds!)
2. 🔄 **Auto-retry**: No more "try again" buttons
3. 💾 **Persistent State**: Survives app restarts
4. 🛡️ **Secure Storage**: Tokens in SecureStore, state in AsyncStorage

## 🛠️ Implementation Examples

### Simple Process Screen

```typescript
const MyProcessScreen = ({ route }) => {
  const resumeProcessId = route.params?.resumeProcessId;
  const [processId, setProcessId] = useState(resumeProcessId);
  const { process, updateProgress, updateData } = useProcessState(processId);
  
  // Resume or start new
  useEffect(() => {
    if (resumeProcessId) {
      const data = getProcessData(resumeProcessId);
      restoreStateFromData(data);
    } else {
      createNewProcess();
    }
  }, []);

  const performStep = async () => {
    await updateProgress(progress + 20, `Step ${stepNumber}`);
    // Do work...
    await updateData({ stepResults: results });
  };
};
```

### Long-running Upload

```typescript
const uploadWithPersistence = async (files, processId) => {
  for (let i = 0; i < files.length; i++) {
    const progress = (i / files.length) * 100;
    await updateProgress(progress, `Uploading ${i + 1}/${files.length}`);
    
    try {
      const result = await uploadFile(files[i]);
      await updateData({ 
        uploadedFiles: [...existing, result] 
      });
    } catch (error) {
      await updateData({ 
        failedFiles: [...existing, files[i]] 
      });
    }
  }
};
```

## 🔧 Configuration

### Auth Settings (supabase.ts)
```typescript
// Extended from 9 to 30 minutes
autoRefreshMinutes: 30
```

### Process Cleanup
```typescript
// Keep only 10 most recent completed processes
MAX_STORED_PROCESSES = 10
```

### Validation Timing
```typescript
// Check every 10 minutes, validate every 30 minutes
const checkInterval = 10 * 60 * 1000;
const validationInterval = 30 * 60 * 1000;
```

## 🎯 Best Practices

### 1. **Process Granularity**
- Create processes for workflows > 30 seconds
- Use stages for major steps in the workflow
- Save progress frequently during long operations

### 2. **Data Management**
- Store only essential state, not entire component state
- Use serializable data structures
- Clean up processes when truly complete

### 3. **Error Handling**
- Always wrap long operations in try/catch
- Provide meaningful error messages to users
- Allow process deletion for permanently failed processes

### 4. **Performance**
- Batch updates when possible
- Don't save on every minor state change
- Use debouncing for rapid progress updates

## 🧪 Testing

1. **Start a long process** (AI generation, listing creation)
2. **Background the app** for > 5 minutes → Should continue
3. **Force close the app** → Should resume on restart
4. **Turn off network** during process → Should handle gracefully
5. **Receive phone call** during process → Should pause/resume

## 📊 Performance Improvements

- **99% reduction** in auth checks (2 seconds → 30 minutes)
- **Instant startup** from cached state vs full reload
- **Seamless resumption** vs starting over
- **Background safety** vs losing all progress

This system transforms your app from a traditional "restart everything" model to a modern, resilient experience that users expect from professional mobile apps.
