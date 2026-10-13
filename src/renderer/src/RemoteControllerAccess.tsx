import { useEffect, useState } from "react";
export default function RemoteControllerAccess() {
    const [state, setState] = useState<{ enabled: boolean; addresses: string[]; pin: string }>({ enabled: false, addresses: [], pin: "" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { void window.santtosAPI.getControllerStatus().then(setState).catch(() => setError("Acesso remoto indisponível.")); }, []);
    async function toggle() {
        if (busy) return;
        setBusy(true);
        try { setState(await window.santtosAPI.setControllerEnabled(!state.enabled)); setError(""); }
        catch { setError("Não foi possível abrir a porta 8787. Verifique se ela está em uso."); }
        finally { setBusy(false); }
    }
    return <div className="remote-controller-access"><strong>Programação remota</strong>
        <button disabled={busy} onClick={() => void toggle()}>{state.enabled ? "Desativar acesso" : "Ativar acesso"}</button>
        {state.enabled && <><span>{state.addresses.join(" · ") || "Rede local indisponível"}</span><span>Código: <strong>{state.pin}</strong></span></>}
        {error && <span role="alert">{error}</span>}
    </div>;
}
