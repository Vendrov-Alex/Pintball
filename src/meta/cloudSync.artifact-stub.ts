/**
 * Stand-in for meta/cloudSync.ts used ONLY by the single-file share-link build.
 * See core/auth.artifact-stub.ts's header comment for why this has to be a
 * resolution-time swap rather than a runtime guard.
 */

export function initCloudSync(): void {}

export async function flushCloudSync(): Promise<void> {}
