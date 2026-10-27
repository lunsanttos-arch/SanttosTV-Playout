import type { MediaItem } from '../../renderer/src/App';
import type { WebInput } from '../../renderer/src/WebInputsPanel';
export function secondsUntilInputClock(endTime: string, now?: Date): number;
export function webInputToMedia(input: WebInput): MediaItem;
export function scheduleInputClocks<T extends MediaItem>(items: T[], startAt?: string | null): T[];
