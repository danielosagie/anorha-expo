import AsyncStorage from '@react-native-async-storage/async-storage';

// Feature flag to disable process persistence during debugging
const ENABLE_PROCESS_PERSISTENCE = true;

// Define process types
export enum ProcessType {
  AI_GENERATION = 'AI_GENERATION',
  LISTING_CREATION = 'LISTING_CREATION',
  PHOTO_UPLOAD = 'PHOTO_UPLOAD',
  PRODUCT_MATCHING = 'PRODUCT_MATCHING',
  SYNC_OPERATION = 'SYNC_OPERATION',
}

// Define process status
export enum ProcessStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// Base process state interface
export interface BaseProcessState {
  id: string;
  type: ProcessType;
  status: ProcessStatus;
  userId: string;
  createdAt: number;
  updatedAt: number;
  currentStage: string;
  progress: number; // 0-100
  data: Record<string, any>;
  error?: string;
  metadata?: Record<string, any>;
}

// Specific process state interfaces
export interface AIGenerationProcessState extends BaseProcessState {
  type: ProcessType.AI_GENERATION;
  data: {
    imageUrls: string[];
    productId?: string;
    variantId?: string;
    selectedPlatforms: string[];
    generatedResults?: any;
    currentAnalysisStage?: 'analyzing' | 'generating' | 'enhancing' | 'complete';
  };
}

export interface ListingCreationProcessState extends BaseProcessState {
  type: ProcessType.LISTING_CREATION;
  data: {
    images: Array<{ uri: string; uploaded?: boolean; uploadedUrl?: string }>;
    selectedPlatforms: string[];
    listingStage: string; // From ListingStage enum
    productRecognition?: any;
    visualMatches?: any[];
    generatedData?: any;
    formData?: Record<string, any>;
  };
}

export interface PhotoUploadProcessState extends BaseProcessState {
  type: ProcessType.PHOTO_UPLOAD;
  data: {
    imageUris: string[];
    uploadedUrls: string[];
    failedUploads: string[];
    uploadProgress: Record<string, number>;
  };
}

export type ProcessState = AIGenerationProcessState | ListingCreationProcessState | PhotoUploadProcessState;

const PROCESS_STORAGE_KEY = 'sssync_processes';
const MAX_STORED_PROCESSES = 10; // Keep only recent processes

export class ProcessPersistence {
  private static instance: ProcessPersistence;
  private processes: Map<string, ProcessState> = new Map();
  private listeners: Map<string, Array<(process: ProcessState) => void>> = new Map();

  static getInstance(): ProcessPersistence {
    if (!ProcessPersistence.instance) {
      ProcessPersistence.instance = new ProcessPersistence();
    }
    return ProcessPersistence.instance;
  }

  // Initialize and load existing processes
  async initialize(userId: string): Promise<void> {
    if (!ENABLE_PROCESS_PERSISTENCE) {
      console.log('[ProcessPersistence] Process persistence disabled');
      return;
    }

    try {
      const stored = await AsyncStorage.getItem(`${PROCESS_STORAGE_KEY}_${userId}`);
      if (stored) {
        const processArray: ProcessState[] = JSON.parse(stored);
        this.processes.clear();
        
        // Only load non-completed processes
        processArray
          .filter(p => p.status !== ProcessStatus.COMPLETED && p.status !== ProcessStatus.CANCELLED)
          .forEach(process => {
            this.processes.set(process.id, process);
          });
        
        console.log(`[ProcessPersistence] Loaded ${this.processes.size} active processes for user ${userId}`);
      }
    } catch (error) {
      console.error('[ProcessPersistence] Failed to load processes:', error);
      // Don't throw - let app continue without process persistence
    }
  }

  // Save a process state
  async saveProcess(process: ProcessState): Promise<void> {
    try {
      process.updatedAt = Date.now();
      this.processes.set(process.id, process);
      
      await this.persistToStorage(process.userId);
      
      // Notify listeners
      const processListeners = this.listeners.get(process.id) || [];
      processListeners.forEach(listener => listener(process));
      
      console.log(`[ProcessPersistence] Saved process ${process.id} (${process.type})`);
    } catch (error) {
      console.error('[ProcessPersistence] Failed to save process:', error);
    }
  }

  // Get a specific process
  getProcess(processId: string): ProcessState | null {
    return this.processes.get(processId) || null;
  }

  // Get all processes for a user
  getAllProcesses(userId: string): ProcessState[] {
    return Array.from(this.processes.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Get active processes (not completed/cancelled)
  getActiveProcesses(userId: string): ProcessState[] {
    return this.getAllProcesses(userId)
      .filter(p => p.status === ProcessStatus.IN_PROGRESS || p.status === ProcessStatus.PAUSED);
  }

  // Update process status
  async updateProcessStatus(processId: string, status: ProcessStatus, error?: string): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) return;

    process.status = status;
    process.updatedAt = Date.now();
    
    if (error) {
      process.error = error;
    }

    await this.saveProcess(process);
  }

  // Update process progress
  async updateProcessProgress(processId: string, progress: number, currentStage?: string): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) return;

    process.progress = Math.min(100, Math.max(0, progress));
    if (currentStage) {
      process.currentStage = currentStage;
    }
    process.updatedAt = Date.now();

    await this.saveProcess(process);
  }

  // Update process data
  async updateProcessData(processId: string, dataUpdate: Record<string, any>): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) return;

    process.data = { ...process.data, ...dataUpdate };
    process.updatedAt = Date.now();

    await this.saveProcess(process);
  }

  // Delete a process
  async deleteProcess(processId: string): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) return;

    this.processes.delete(processId);
    await this.persistToStorage(process.userId);
    
    console.log(`[ProcessPersistence] Deleted process ${processId}`);
  }

  // Clean up old completed processes
  async cleanupOldProcesses(userId: string): Promise<void> {
    const userProcesses = this.getAllProcesses(userId);
    const completedProcesses = userProcesses
      .filter(p => p.status === ProcessStatus.COMPLETED || p.status === ProcessStatus.CANCELLED)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    // Keep only the most recent completed processes
    const toDelete = completedProcesses.slice(MAX_STORED_PROCESSES);
    
    for (const process of toDelete) {
      this.processes.delete(process.id);
    }

    if (toDelete.length > 0) {
      await this.persistToStorage(userId);
      console.log(`[ProcessPersistence] Cleaned up ${toDelete.length} old processes`);
    }
  }

  // Listen to process updates
  addProcessListener(processId: string, listener: (process: ProcessState) => void): () => void {
    if (!this.listeners.has(processId)) {
      this.listeners.set(processId, []);
    }
    
    this.listeners.get(processId)!.push(listener);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(processId);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  // Create a new process
  createProcess<T extends ProcessState>(
    type: ProcessType,
    userId: string,
    initialData: T['data'],
    metadata?: Record<string, any>
  ): T {
    const process: ProcessState = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      status: ProcessStatus.PENDING,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentStage: 'initialized',
      progress: 0,
      data: initialData,
      metadata,
    };

    return process as T;
  }

  // Resume processes that were interrupted
  getResumableProcesses(userId: string): ProcessState[] {
    return this.getActiveProcesses(userId)
      .filter(p => p.status === ProcessStatus.IN_PROGRESS || p.status === ProcessStatus.PAUSED);
  }

  private async persistToStorage(userId: string): Promise<void> {
    try {
      const userProcesses = this.getAllProcesses(userId);
      await AsyncStorage.setItem(`${PROCESS_STORAGE_KEY}_${userId}`, JSON.stringify(userProcesses));
    } catch (error) {
      console.error('[ProcessPersistence] Failed to persist to storage:', error);
    }
  }
}
