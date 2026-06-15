import React, { useEffect, useState, useCallback, useContext } from 'react';
import { ProcessPersistence, ProcessState, ProcessType, ProcessStatus } from '../utils/ProcessPersistence';
import { SessionContext } from '../context/SessionContext';
import { createLogger } from '../utils/logger';
const log = createLogger('useProcessState');


export function useProcessState<T extends ProcessState>(processId?: string) {
  const [process, setProcess] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const sessionContext = useContext(SessionContext);
  const processPersistence = ProcessPersistence.getInstance();

  useEffect(() => {
    if (!processId) return;

    const currentProcess = processPersistence.getProcess(processId) as T | null;
    setProcess(currentProcess);

    // Listen for process updates
    const unsubscribe = processPersistence.addProcessListener(processId, (updatedProcess) => {
      setProcess(updatedProcess as T);
    });

    return unsubscribe;
  }, [processId]);

  const updateStatus = useCallback(async (status: ProcessStatus, error?: string) => {
    if (!processId) return;
    await processPersistence.updateProcessStatus(processId, status, error);
  }, [processId]);

  const updateProgress = useCallback(async (progress: number, currentStage?: string) => {
    if (!processId) return;
    await processPersistence.updateProcessProgress(processId, progress, currentStage);
  }, [processId]);

  const updateData = useCallback(async (dataUpdate: Record<string, any>) => {
    if (!processId) return;
    await processPersistence.updateProcessData(processId, dataUpdate);
  }, [processId]);

  const deleteProcess = useCallback(async () => {
    if (!processId) return;
    await processPersistence.deleteProcess(processId);
  }, [processId]);

  return {
    process,
    isLoading,
    updateStatus,
    updateProgress,
    updateData,
    deleteProcess,
  };
}

export function useActiveProcesses() {
  const [processes, setProcesses] = useState<ProcessState[]>([]);
  const sessionContext = useContext(SessionContext);
  const processPersistence = ProcessPersistence.getInstance();

  const refreshProcesses = useCallback(() => {
    if (!sessionContext?.user?.id) return;
    
    const activeProcesses = processPersistence.getActiveProcesses(sessionContext.user.id);
    setProcesses(activeProcesses);
  }, [sessionContext?.user?.id]);

  useEffect(() => {
    refreshProcesses();
    
    // Refresh every 5 seconds to catch updates
    const interval = setInterval(refreshProcesses, 5000);
    return () => clearInterval(interval);
  }, [refreshProcesses]);

  return {
    processes,
    refreshProcesses,
  };
}

export function useProcessResumption() {
  const sessionContext = useContext(SessionContext);
  const processPersistence = ProcessPersistence.getInstance();

  const getResumableProcesses = useCallback(() => {
    if (!sessionContext?.user?.id) return [];
    
    return processPersistence.getResumableProcesses(sessionContext.user.id);
  }, [sessionContext?.user?.id]);

  const initializeProcessSystem = useCallback(async () => {
    if (!sessionContext?.user?.id) return;
    
    await processPersistence.initialize(sessionContext.user.id);
    log.debug('[useProcessResumption] Process system initialized');
  }, [sessionContext?.user?.id]);

  return {
    getResumableProcesses,
    initializeProcessSystem,
  };
}
