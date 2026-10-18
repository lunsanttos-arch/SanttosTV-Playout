import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "./App";

export default function LibraryWatchDialog({ item, onClose, remote = false, clip = false }: { item: MediaItem; onClose: () => void; remote?: boolean; clip?: boolean }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    const [externalBusy, setExternalBusy] = useState(false);
    useEffect(() => {
        let disposed = false;
        const panel = dialog.current, player = video.current;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panel?.showModal();
        const mediaId = item.sourceMediaId || item.id;
        if (remote) setUrl(`/api/media/watch?id=${encodeURIComponent(mediaId)}`);
        else void window.santtosAPI.getLibraryWatchSource(mediaId).then(result => {
            if (disposed) return;
            if (!result.ok || !result.filePath) throw Error(result.error || "Arquivo indisponível.");
            setUrl(window.santtosAPI.getMediaFileUrl(result.filePath));
        }).catch(reason => { if (!disposed) setError(String(reason.message || reason)); });
        return () => {
            disposed = true;
            if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
            panel?.close();
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [item.id, remote]);
    function clipBounds(player: HTMLVideoElement) {
        const start = clip ? Math.max(0, Number(item.inPoint) || 0) : 0;
        const end = clip && Number(item.outPoint) > start ? Math.min(Number(item.outPoint), player.duration || Infinity) : player.duration;
        return {start, end};
    }
    async function openExternal() {
        setExternalBusy(true);
        try {
            const result = await window.santtosAPI.openLibraryFile(item.sourceMediaId || item.id);
            if (!result.ok) throw Error(result.error || "Não foi possível abrir o player do sistema.");
            onClose();
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setExternalBusy(false); }
    }
    return <dialog className="library-watch-dialog" ref={dialog} aria-labelledby="library-watch-title"
        onCancel={event => { event.preventDefault(); onClose(); }}>
        <header><h2 id="library-watch-title">{item.name}</h2><button autoFocus onClick={onClose} aria-label="Fechar reprodução">Fechar</button></header>
        <p>{clip ? "Reprodução do trecho programado" : "Reprodução de consulta"} — não altera o PROGRAM.</p>
        <video ref={video} src={url || undefined} controls preload="metadata" playsInline
            onLoadedMetadata={event => { if(!clip)return;const player=event.currentTarget,{start,end}=clipBounds(player);if(start>=end){setError("O trecho programado está fora da duração atual do arquivo.");return;}player.currentTime=start; }}
            onTimeUpdate={event => { const player=event.currentTarget, {end}=clipBounds(player); if(clip && player.currentTime>=end){player.pause();if(player.currentTime>end)player.currentTime=end;} }}
            onSeeked={event => { if(!clip)return;const player=event.currentTarget,{start,end}=clipBounds(player);if(player.currentTime<start)player.currentTime=start;else if(player.currentTime>end)player.currentTime=end; }}
            onPlay={event => { const player=event.currentTarget,{start,end}=clipBounds(player);if(clip && player.currentTime>=end)player.currentTime=start; }}
            onLoadedData={() => { const player=video.current;if(!player)return;const {start,end}=clipBounds(player);if(!clip||start<end)void player.play().catch(() => {}); }}
            onError={() => { if (url) setError(remote ? "Não foi possível reproduzir o arquivo. Confira a conexão, a sessão e a compatibilidade do formato com o navegador." : "O reprodutor interno não conseguiu abrir este formato. Você pode usar o player do sistema."); }} />
        {!url && !error && <p role="status">Abrindo arquivo…</p>}
        {error && <div className="library-watch-error" role="alert"><p>{error}</p>
            {!remote && <button disabled={externalBusy} onClick={() => void openExternal()}>Abrir no player do sistema</button>}</div>}
    </dialog>;
}
