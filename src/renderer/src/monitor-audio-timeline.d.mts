export class MonitorAudioTimeline {
    reset(): void;
    plan(input: {epoch:number;mediaTime:number;frames:number;rate:number;deviceAt:number}):number|null;
}
