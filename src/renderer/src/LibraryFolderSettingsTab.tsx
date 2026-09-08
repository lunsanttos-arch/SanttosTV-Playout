import { useEffect, useState } from "react";

export interface LibraryCategory {
    id: string;
    name: string;
    folderPath: string;
    builtIn?: boolean;
}

export default function LibraryFolderSettingsTab() {
    const [categories, setCategories] = useState<LibraryCategory[]>([]);
    const [status, setStatus] = useState("");
    const [saving, setSaving] = useState(false);

    async function load() {
        try {
            const result = await (window as any).santtosAPI.getLibraryCategories();
            setCategories(result ?? []);
        } catch (error) {
            console.error(error);
            setStatus("Não foi possível carregar as pastas da Biblioteca.");
        }
    }

    useEffect(() => {
        void load();
    }, []);

    async function chooseFolder(id: string) {
        try {
            const result = await (window as any).santtosAPI.selectLibraryFolder();
            if (!result?.ok || !result.folderPath) return;
            setCategories((current) =>
                current.map((item) =>
                    item.id === id
                        ? { ...item, folderPath: result.folderPath }
                        : item
                )
            );
            setStatus("");
        } catch (error) {
            console.error(error);
            setStatus("Não foi possível selecionar a pasta.");
        }
    }

    function createCategory() {
        const name = window.prompt("Nome da nova aba da Biblioteca:")?.trim();
        if (!name) return;
        const id = `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setCategories((current) => [
            ...current,
            { id, name: name.slice(0, 40), folderPath: "", builtIn: false }
        ]);
        setStatus("Nova aba criada. Escolha a pasta e salve.");
    }

    function removeCategory(id: string) {
        setCategories((current) => current.filter((item) => item.id !== id));
        setStatus("");
    }

    async function save() {
        setSaving(true);
        try {
            const result = await (window as any).santtosAPI.saveLibraryCategories(categories);
            if (!result?.ok) throw new Error(result?.error ?? "Falha ao salvar");
            setCategories(result.categories ?? categories);
            setStatus("Pastas da Biblioteca salvas.");
        } catch (error) {
            console.error(error);
            setStatus("Não foi possível salvar as pastas da Biblioteca.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="library-settings-tab">
            <div className="library-settings-intro">
                <div>
                    <h2>Pastas da Biblioteca</h2>
                    <p>Cada sub-aba do Playout exibe somente os arquivos da pasta configurada aqui.</p>
                </div>
                <button type="button" onClick={createCategory}>+ Nova aba</button>
            </div>

            <div className="library-folder-list">
                {categories.map((category) => (
                    <div className="library-folder-row" key={category.id}>
                        <div className="library-folder-name">
                            <strong>{category.name}</strong>
                            <span>{category.builtIn ? "Aba padrão" : "Aba personalizada"}</span>
                        </div>
                        <div className="library-folder-path" title={category.folderPath || "Sem pasta configurada"}>
                            {category.folderPath || "Nenhuma pasta configurada"}
                        </div>
                        <button type="button" onClick={() => chooseFolder(category.id)}>Escolher pasta</button>
                        {!category.builtIn && (
                            <button
                                type="button"
                                className="danger-button"
                                onClick={() => removeCategory(category.id)}
                            >
                                Excluir aba
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className="library-settings-actions">
                <span>{status}</span>
                <button className="primary-button" type="button" disabled={saving} onClick={save}>
                    {saving ? "Salvando..." : "Salvar pastas"}
                </button>
            </div>
        </div>
    );
}
