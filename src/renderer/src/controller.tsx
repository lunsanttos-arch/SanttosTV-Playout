import React from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import OpecSchedulerPanel from "./OpecSchedulerPanel";
import type { MediaItem } from "./App";
import "./styles.css";
import "./brand-theme.css";

async function request(url: string, body?: unknown) {
    const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível acessar o master.");
    return result;
}
async function downloadRundown(format: "pdf" | "html", rundown: Parameters<typeof window.santtosAPI.exportRundownPdf>[0]) {
    const response = await fetch(`/api/rundown/${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rundown) });
    if (!response.ok) throw Error((await response.json()).error || "Não foi possível exportar o roteiro.");
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
    link.href = url; link.download = `Roteiro-${rundown.date}.${format}`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); return { ok: true };
}
function Controller() {
    const [media, setMedia] = useState<MediaItem[] | null>(null);
    const [pin, setPin] = useState("");
    const [error, setError] = useState("");
    async function login() {
        try {
            await request("/api/login", { pin });
            window.santtosAPI = {
                getWeeklyRundown: weekday => request(`/api/weekly?weekday=${weekday}`),
                saveWeeklyRundown: (weekday, rundown) => request("/api/weekly", { weekday, rundown }),
                exportRundownHtml: rundown => downloadRundown("html", rundown),
                exportRundownPdf: rundown => downloadRundown("pdf", rundown), getLibraryCategories: () => request("/api/library-categories"), getDailyRundown: date => request(`/api/rundown?date=${encodeURIComponent(date)}`),
                saveDailyRundown: rundown => request("/api/rundown", rundown) } as typeof window.santtosAPI;
            setMedia(await request("/api/media"));
        } catch (error) { setError(error instanceof Error ? error.message : "Acesso indisponível."); }
    }
    return <main className="remote-scheduler-workspace">{media ? <OpecSchedulerPanel media={media} remote onApply={() => {}} /> :
        <section className="broadcast-settings-card remote-controller-login"><h1>SanTTos · Programação</h1><p>Informe o código exibido no computador master.</p>
            <input aria-label="Código de acesso" type="password" value={pin} onChange={event => setPin(event.currentTarget.value)}
                onKeyDown={event => { if (event.key === "Enter") void login(); }} /><button onClick={() => void login()}>Entrar</button>
            {error && <p role="alert">{error}</p>}</section>}</main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Controller /></React.StrictMode>);
