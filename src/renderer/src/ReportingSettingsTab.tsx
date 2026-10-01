import { useEffect, useState } from "react";

export default function ReportingSettingsTab() {
    const [folder, setFolder] = useState("");
    const [status, setStatus] = useState("");

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

    useEffect(() => {
        void loadFolder();
    }, []);

    async function chooseFolder() {
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
                "Pasta dos relatórios XML atualizada."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível configurar a pasta."
            );
        }
    }

    async function resetFolder() {
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
        }
    }

    return (
        <div className="broadcast-settings-grid">
            <section className="broadcast-settings-card">
                <div className="broadcast-settings-card-heading">
                    <div>
                        <h2>Relatórios de exibição</h2>
                        <p>
                            Um arquivo XML é mantido por dia com entradas,
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
                        onClick={() =>
                            void chooseFolder()
                        }
                    >
                        Escolher pasta
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            void resetFolder()
                        }
                    >
                        Restaurar padrão
                    </button>
                </div>

                <div className="settings-info">
                    Formato: Relatorio_Exibicao_AAAA-MM-DD.xml
                </div>

                {status && (
                    <div className="settings-info">
                        {status}
                    </div>
                )}
            </section>
        </div>
    );
}
