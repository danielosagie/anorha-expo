import {
  isUnhealthyPlatformConnection,
  type ConnectionVisibilityFields,
} from './platformConnectionVisibility.ts';

export type ReconnectVerification = 'verified' | 'could_not_verify';

/** A fresh row must exist and have no credential-health failure. */
export function decideReconnectVerification({
  refreshSucceeded,
  connection,
}: {
  refreshSucceeded: boolean;
  connection?: ConnectionVisibilityFields | null;
}): ReconnectVerification {
  if (!refreshSucceeded || !connection) return 'could_not_verify';
  if (connection.IsEnabled === false || isUnhealthyPlatformConnection(connection)) {
    return 'could_not_verify';
  }
  return 'verified';
}
