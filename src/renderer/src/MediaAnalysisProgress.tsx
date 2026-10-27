import { useEffect, useState } from "react";
import "./media-analysis-progress.css";

export interface AnalysisStatus {
    queued: number;
    running: string | null;
    completed: number;
    active: { id: string; name: string; phase: string; percent: number | null } | null;
    queue: { id: string; name: string; position: number }[];
}

const PHASES: Record<string, string> = {
    preparing: "Preparando análise", video: "Verificando vídeo",
    recovery: "Verificando recuperação do vídeo", "audio-stereo": "Medindo áudio estéreo",
    "audio-mono": "Medindo áudio mono", checksum: "Conferindo integridade do arquivo"
};

export default function MediaAnalysisProgress() {
    const [status, setStatus] = useState<AnalysisStatus | null>(null);
    useEffect(() => {
        let canceled = false, timer: ReturnType<typeof setTimeout>;
        async function update() {
            try {
                const next = await window.santtosAPI.getMediaAnalysisStatus();
                if (!canceled) setStatus(next);
            } catch { if (!canceled) setStatus(null); }
            if (!canceled) timer = setTimeout(() => void update(), 1000);
        }
        void update();
        return () => { canceled = true; clearTimeout(timer); };
    }, []);
    if (!status || (!status.active && !status.queued)) return null;
    const active = status.active;
    const percent = active?.percent ?? null;
    return <section className="media-analysis-progress" aria-label="Processamento dos materiais">
        <div className="media-analysis-heading"><strong title={active?.name}>{active?.name ?? "Aguardando análise"}</strong>
            <span>{percent === null ? "Em andamento" : `${percent}% da etapa`}</span></div>
        <progress aria-label={active ? `${PHASES[active.phase] ?? active.phase}: ${active.name}` : "Fila de análise"}
            max={100} {...(percent === null ? {} : { value: percent })} />
        <div className="media-analysis-detail"><span>{active ? PHASES[active.phase] ?? active.phase : "Preparando fila"}</span><span>{status.queued} na fila</span></div>
        {status.queued > 0 && <details><summary>Ver fila de processamento</summary><ol>
            {status.queue.map(item => <li key={item.id} title={item.name}>{item.position}. {item.name}</li>)}
            {status.queued > status.queue.length && <li>Mais {status.queued - status.queue.length} material(is)…</li>}
        </ol></details>}
    </section>;
}
