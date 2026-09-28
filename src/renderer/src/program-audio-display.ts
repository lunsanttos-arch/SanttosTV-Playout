/**
 * A barra no player mede a prévia se o sender de áudio NDI ainda não está
 * pronto. Nunca rotular esses níveis como áudio transmitido para o vMix.
 */
export type AudioMeterRoute = "ndi" | "preview" | "no-track" | "stopped";

export interface MeterInput {
    nativeOutput: boolean;
    isPlaying: boolean;
    nativeState: string;
    nativeActive?: boolean;
}

export function resolveAudioMeterRoute({
    nativeOutput, isPlaying, nativeState, nativeActive
}: MeterInput): AudioMeterRoute {
    if (!isPlaying) return "stopped";
    if (!nativeOutput) return "preview";
    if (nativeState === "NO_TRACK") return "no-track";
    if (nativeState === "FLOWING" && nativeActive === true) return "ndi";
    return "preview";
}

export function audioMeterSourceLabel(route: AudioMeterRoute, nativeState: string): string {
    if (route === "ndi") return "NDI PCM • FONTE";
    if (route === "stopped") return "PARADO";
    if (route === "no-track") return "SEM FAIXA";
    if (nativeState === "REBUILD_REQUIRED") return "PRÉVIA • NDI ANTIGO";
    if (nativeState === "PIPE_NOT_READY") return "PRÉVIA • PIPE OFF";
    if (nativeState === "ERROR") return "PRÉVIA • FALHA NDI";
    if (nativeState === "STARTING") return "PRÉVIA • NDI INICIANDO";
    return "PRÉVIA LOCAL";
}
