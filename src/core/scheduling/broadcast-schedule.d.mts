export const ALIGNMENT_TOLERANCE_SECONDS: number;
export interface ScheduleItem { id?: string; inPoint?: number | null; outPoint?: number | null; duration?: number | null; loop?: boolean; freezeEnd?: boolean; placeholder?: boolean; liveSlot?: boolean; scheduleDate?: string }
export function previousDate(date: string): string;
export function localDate(value: Date): string;
export function clipSeconds(item: ScheduleItem): number | null;
export function durationSeconds(items: ScheduleItem[]): number | null;
export function clockDuration(seconds: number): string;
export function alignmentMessage(delta: number): string;
export function scheduleBounds(date: string, startTime: string, items: ScheduleItem[], previous?: {date: string; endAt?: string | null; items: ScheduleItem[]; updatedAt?: string | null} | null): {startAt: string | null; endAt: string | null; previousDate: string | null; previousUpdatedAt: string | null};
export function planRundownApplication(options: {items: ScheduleItem[]; date: string; startAt: string; queue?: ScheduleItem[]; snapshot?: {state?: string; itemId?: string; positionSeconds?: number}; nowMs?: number}): {timeline: ScheduleItem[]; deltaSeconds: number; positionSeconds: number | null; message: string};
