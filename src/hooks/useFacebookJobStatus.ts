/**
 * @deprecated Import useComputerJobStatus from ./useComputerJobStatus.
 * This alias remains for one release so downstream imports keep working.
 */
export {
  useComputerJobStatus,
  useComputerJobStatus as useFacebookJobStatus,
} from './useComputerJobStatus';
export type {
  ComputerJobStatus,
  ComputerJobStatus as FacebookJobStatus,
  ConnectedComputer,
  DispatchTone,
  VariantDispatchStatus,
} from './useComputerJobStatus';
