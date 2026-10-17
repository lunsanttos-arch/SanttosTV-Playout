import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "./App";

export default function LibraryWatchDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
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
        void window.santtosAPI.getLibraryWatchSource(item.id).then(result => {
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
    }, [item.id]);
    async function openExternal() {
        setExternalBusy(true);
        try {
            const result = await window.santtosAPI.openLibraryFile(item.id);
            if (!result.ok) throw Error(result.error || "Não foi possível abrir o player do sistema.");
            onClose();
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setExternalBusy(false); }
    }
    return <dialog className="library-watch-dialog" ref={dialog} aria-labelledby="library-watch-title"
        onCancel={event => { event.preventDefault(); onClose(); }}>
        <header><h2 id="library-watch-title">{item.name}</h2><button autoFocus onClick={onClose} aria-label="Fechar reprodução">Fechar</button></header>
        <p>Reprodução local — não altera o PROGRAM.</p>
        <video ref={video} src={url || undefined} controls preload="metadata" playsInline
            onLoadedData={() => { void video.current?.play().catch(() => {}); }}
            onError={() => { if (url) setError("O reprodutor interno não conseguiu abrir este formato. Você pode usar o player do sistema."); }} />
        {!url && !error && <p role="status">Abrindo arquivo…</p>}
        {error && <div className="library-watch-error" role="alert"><p>{error}</p>
            <button disabled={externalBusy} onClick={() => void openExternal()}>Abrir no player do sistema</button></div>}
    </dialog>;
}
