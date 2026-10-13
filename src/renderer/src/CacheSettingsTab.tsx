import { useEffect, useState } from "react";

export default function CacheSettingsTab() {
    const [limit, setLimit] = useState(80);
    const [usage, setUsage] = useState(0);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void window.santtosAPI.getServerMediaSettings().then(result => {
            if (result.settings) setLimit(result.settings.cacheMaxGb);
            setUsage((result.status?.cachedBytes ?? 0) / 1024 ** 3);
        }).catch(() => setStatus("Não foi possível carregar o cache."));
    }, []);
    async function save() {
        setBusy(true);
        try {
            const result = await window.santtosAPI.saveServerMediaSettings({ enabled: true, rootPath: "",
                cacheEnabled: true, cacheMaxGb: limit, prefetchNext: true });
            setStatus(result.ok ? "Limite salvo." : result.error ?? "Não foi possível salvar.");
        } catch { setStatus("Não foi possível salvar o limite."); } finally { setBusy(false); }
    }
    return <div className="broadcast-settings-grid"><section className="broadcast-settings-card">
        <h2>Cache automático</h2><p>Mídias fora do disco C: são preparadas localmente. Ao atingir o limite,
            os arquivos mais antigos são removidos, preservando o material em uso.</p>
        <label className="broadcast-setting-field"><span>Limite em GB</span>
            <input type="number" min={5} max={1000} value={limit} onChange={event => setLimit(Number(event.currentTarget.value))} /></label>
        <p>{usage.toFixed(1)} GB em uso</p><button onClick={() => void save()} disabled={busy}>Salvar limite</button>
        {status && <p role="status">{status}</p>}
    </section></div>;
}
