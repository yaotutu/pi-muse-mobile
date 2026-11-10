import type { ImageSourcePropType } from 'react-native';
import type { CompanionPackSummary, CompanionState } from '../api/companion-contracts';
export type { CompanionState, CompanionPackSummary, CompanionDiagnostic, CompanionClient } from '../api/companion-contracts';
export type CompanionImages = Record<CompanionState, ImageSourcePropType>;
export type CompanionKey = 'builtin:penguin' | `server:${string}`;
export type CompanionPack = { key: CompanionKey; name: string; description: string; images: CompanionImages };
export type CachedCompanion = { summary: CompanionPackSummary; images: CompanionImages };
export interface CompanionPreferences { read(): Promise<string | null>; write(key: string): Promise<void> }
export interface CompanionCache {
  read(scope: string, packId: string, signal: AbortSignal): Promise<CachedCompanion | undefined>;
  prepare(scope: string, pack: CompanionPackSummary, fetchAsset: (state: CompanionState) => Promise<Uint8Array>, signal: AbortSignal): Promise<CachedCompanion>;
}
