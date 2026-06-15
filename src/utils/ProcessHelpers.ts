import { 
  ProcessPersistence, 
  ProcessType, 
  ProcessStatus, 
  ListingCreationProcessState,
  AIGenerationProcessState 
} from './ProcessPersistence';
import { createLogger } from './logger';
const log = createLogger('ProcessHelpers');


// Helper functions for common process operations

export class ProcessHelpers {
  private static processPersistence = ProcessPersistence.getInstance();

  // Create a new listing creation process
  static async createListingProcess(
    userId: string,
    initialData: {
      images: Array<{ uri: string; uploaded?: boolean; uploadedUrl?: string }>;
      selectedPlatforms: string[];
      listingStage: string;
    }
  ): Promise<string> {
    const process = this.processPersistence.createProcess<ListingCreationProcessState>(
      ProcessType.LISTING_CREATION,
      userId,
      initialData
    );

    await this.processPersistence.saveProcess(process);
    log.debug('[ProcessHelpers] Created listing process:', process.id);
    
    return process.id;
  }

  // Create a new AI generation process
  static async createAIGenerationProcess(
    userId: string,
    initialData: {
      imageUrls: string[];
      selectedPlatforms: string[];
      productId?: string;
      variantId?: string;
    }
  ): Promise<string> {
    const process = this.processPersistence.createProcess<AIGenerationProcessState>(
      ProcessType.AI_GENERATION,
      userId,
      initialData
    );

    await this.processPersistence.saveProcess(process);
    log.debug('[ProcessHelpers] Created AI generation process:', process.id);
    
    return process.id;
  }

  // Update listing stage and save
  static async updateListingStage(
    processId: string,
    stage: string,
    progress: number,
    additionalData?: Record<string, any>
  ): Promise<void> {
    await this.processPersistence.updateProcessProgress(processId, progress, stage);
    
    if (additionalData) {
      await this.processPersistence.updateProcessData(processId, {
        listingStage: stage,
        ...additionalData,
      });
    }

    log.debug(`[ProcessHelpers] Updated listing process ${processId} to stage: ${stage} (${progress}%)`);
  }

  // Update AI generation stage
  static async updateAIGenerationStage(
    processId: string,
    stage: 'analyzing' | 'generating' | 'enhancing' | 'complete',
    progress: number,
    additionalData?: Record<string, any>
  ): Promise<void> {
    await this.processPersistence.updateProcessProgress(processId, progress, stage);
    
    if (additionalData) {
      await this.processPersistence.updateProcessData(processId, {
        currentAnalysisStage: stage,
        ...additionalData,
      });
    }

    log.debug(`[ProcessHelpers] Updated AI generation process ${processId} to stage: ${stage} (${progress}%)`);
  }

  // Mark process as completed successfully
  static async completeProcess(processId: string): Promise<void> {
    await this.processPersistence.updateProcessStatus(processId, ProcessStatus.COMPLETED);
    log.debug(`[ProcessHelpers] Completed process ${processId}`);
  }

  // Mark process as failed
  static async failProcess(processId: string, error: string): Promise<void> {
    await this.processPersistence.updateProcessStatus(processId, ProcessStatus.FAILED, error);
    log.debug(`[ProcessHelpers] Failed process ${processId}:`, error);
  }

  // Pause a process (when user backgrounds the app during long operation)
  static async pauseProcess(processId: string): Promise<void> {
    await this.processPersistence.updateProcessStatus(processId, ProcessStatus.PAUSED);
    log.debug(`[ProcessHelpers] Paused process ${processId}`);
  }

  // Resume a paused process
  static async resumeProcess(processId: string): Promise<void> {
    await this.processPersistence.updateProcessStatus(processId, ProcessStatus.IN_PROGRESS);
    log.debug(`[ProcessHelpers] Resumed process ${processId}`);
  }

  // Get process data for resumption
  static getProcessData(processId: string): any {
    const process = this.processPersistence.getProcess(processId);
    return process?.data || null;
  }

  // Clean up old processes
  static async cleanupUserProcesses(userId: string): Promise<void> {
    await this.processPersistence.cleanupOldProcesses(userId);
    log.debug(`[ProcessHelpers] Cleaned up old processes for user ${userId}`);
  }
}

// Hook for easy process state management in components
export function useProcessPersistence() {
  return {
    createListingProcess: ProcessHelpers.createListingProcess,
    createAIGenerationProcess: ProcessHelpers.createAIGenerationProcess,
    updateListingStage: ProcessHelpers.updateListingStage,
    updateAIGenerationStage: ProcessHelpers.updateAIGenerationStage,
    completeProcess: ProcessHelpers.completeProcess,
    failProcess: ProcessHelpers.failProcess,
    pauseProcess: ProcessHelpers.pauseProcess,
    resumeProcess: ProcessHelpers.resumeProcess,
    getProcessData: ProcessHelpers.getProcessData,
  };
}
