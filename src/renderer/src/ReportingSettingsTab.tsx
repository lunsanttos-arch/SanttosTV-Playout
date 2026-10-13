import { useEffect, useState } from "react";

export default function ReportingSettingsTab() {
    const [folder, setFolder] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [files, setFiles] = useState<{ date: string; name: string }[]>([]);

    async function loadFolder() {
        try {
            const result =
                await window.santtosAPI
                    .getPlayoutReportFolder();
            if (result.ok) {
                setFolder(
                    result.folder ?? ""
                );
            }
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível carregar a pasta de relatórios."
            );
        }
    }

    useEffect(() => { void loadFolder(); }, []);
    useEffect(() => {
        void window.santtosAPI.getReportFiles().then(result => setFiles(result.files ?? []))
            .catch(() => setStatus("Não foi possível listar os relatórios."));
    }, [folder]);
    async function open(date?: string) {
        if (busy) return;
        setBusy(true);
        try {
            const result = await window.santtosAPI.openReport(date);
            if (!result.ok) setStatus(result.error ?? "Não foi possível abrir o relatório.");
        } catch { setStatus("Não foi possível abrir o relatório."); }
        finally { setBusy(false); }
    }

    async function chooseFolder() {
        if (busy) return;
        setBusy(true);
        setStatus("");
        try {
            const result =
                await window.santtosAPI
                    .selectPlayoutReportFolder();

            if (result.canceled) {
                return;
            }

            if (!result.ok) {
                setStatus(
                    result.error ??
                        "Não foi possível configurar a pasta."
                );
                return;
            }

            setFolder(
                result.folder ?? ""
            );
            setStatus(
                "Pasta dos relatórios atualizada."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível configurar a pasta."
            );
        } finally { setBusy(false); }
    }

    async function resetFolder() {
        if (busy) return;
        setBusy(true);
        setStatus("");
        try {
            const result =
                await window.santtosAPI
                    .resetPlayoutReportFolder();

            if (!result.ok) {
                setStatus(
                    result.error ??
                        "Não foi possível restaurar a pasta padrão."
                );
                return;
            }

            setFolder(
                result.folder ?? ""
            );
            setStatus(
                "Pasta padrão restaurada."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível restaurar a pasta padrão."
            );
        } finally { setBusy(false); }
    }

    return (
        <div className="broadcast-settings-grid">
            <section className="broadcast-settings-card">
                <div className="broadcast-settings-card-heading">
                    <div>
                        <h2>Relatórios de exibição</h2>
                        <p>
                            Relatórios em HTML e Excel, por dia, com entradas,
                            saídas, duração exibida, status e caminho da mídia.
                        </p>
                    </div>
                </div>

                <label className="broadcast-setting-field">
                    <span>Pasta de destino</span>
                    <input
                        type="text"
                        value={folder}
                        readOnly
                        title={folder}
                    />
                </label>

                <div className="settings-inline-actions">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                            void chooseFolder()
                        }
                    >
                        Escolher pasta
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                            void resetFolder()
                        }
                    >
                        Restaurar padrão
                    </button>
                </div>

                <div className="settings-info">
                    HTML para leitura e impressão · XLSX para Excel
                </div>
                <button disabled={busy} onClick={() => void open()}>Abrir pasta</button>
                {files.map(file => <button disabled={busy} key={file.date} onClick={() => void open(file.date)}>
                    Abrir relatório · {file.date}</button>)}
                {files.length === 0 && <p>Nenhum relatório de exibição nesta pasta.</p>}

                {status && (
                    <div className="settings-info">
                        {status}
                    </div>
                )}
            </section>
        </div>
    );
}
