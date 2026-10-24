export interface MonitorTiming { streamId?: string; generation?: number; emittedAt?: number; mediaTimeSeconds?: number; programTimeSeconds?: number }
export interface VideoPlan { epoch: number; generation: number; deadline: number; mediaTimeSeconds: number }
export class ProgramMonitorClock {
    constructor(now?: () => number);
    delayMs: number;
    configureAudioLatency(seconds:number):void;
    epoch: number;
    generation: number;
    now: () => number;
    reset(generation?: number): void;
    subscribe(listener: (reset: boolean) => void): () => void;
    video(payload: MonitorTiming): VideoPlan | null;
    valid(plan: VideoPlan): boolean;
    presented(plan: VideoPlan): boolean;
    checkStall(): boolean;
    audio(payload: MonitorTiming): {status: 'drop' | 'wait' | 'play'; deadline?: number; epoch?: number};
    snapshot(): {resets: number; staleVideo: number; staleAudio: number; videoStalls: number; draws: number; epoch: number; generation: number; videoAgeMs: number | null; videoTime: number | null};
}
export const programMonitorClock: ProgramMonitorClock;
