export interface SyncRule {
  id: string;
  enabled: boolean;
  name: string;
  watchedRoot: string;
  linkProperty: string;
  attributesToCopy: string[];
}

export interface LegacySyncRule extends Omit<SyncRule, "attributesToCopy"> {
  attributeMappings?: string;
  attributesToCopy?: string[];
}
