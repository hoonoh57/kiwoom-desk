/**
 * Generic persistence capability shared by chart runtime plugins.
 *
 * The provider may be Workspace, a test harness, or another host environment.
 * Consumers address namespaced slices and never depend on provider storage shape.
 */
export interface ChartRuntimePersistenceService {
  readonly scope: string;
  read<T = unknown>(slice: string): T | undefined;
  write<T = unknown>(slice: string, value: T | undefined): void;
  snapshot(): Readonly<Record<string, unknown>>;
  flush(): void;
}

export const ChartRuntimePersistenceSlices = Object.freeze({
  CORE: 'core',
  VIEWPORT: 'viewport',
  EXTENSIONS: 'extensions',
} as const);
