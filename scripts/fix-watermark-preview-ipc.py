from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)

# main.js
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")
anchor = '''function registerIpcHandlers() {'''
helper = '''function createWatermarkPreviewDataUrl(filePath) {\n    const validation = validateWatermarkImage(filePath);\n    const image = nativeImage.createFromPath(validation.filePath);\n\n    if (!image || image.isEmpty()) {\n        throw new Error("Não foi possível criar o preview da marca d'água.");\n    }\n\n    const size = image.getSize();\n    const previewWidth = Math.min(640, Math.max(1, size.width));\n    const previewImage = size.width > previewWidth\n        ? image.resize({\n              width: previewWidth,\n              quality: "good"\n          })\n        : image;\n\n    return {\n        dataUrl: previewImage.toDataURL(),\n        width: size.width,\n        height: size.height\n    };\n}\n\n'''
if "function createWatermarkPreviewDataUrl" not in t:
    t = replace_once(t, anchor, helper + anchor, "preview helper")

anchor2 = '''    ipcMain.handle(\n        "watermark:select",'''
handler = '''    ipcMain.handle(\n        "watermark:preview",\n        async (_event, filePath) => {\n            try {\n                const preview =\n                    createWatermarkPreviewDataUrl(\n                        filePath\n                    );\n\n                return {\n                    ok: true,\n                    ...preview\n                };\n            } catch (error) {\n                console.error(\n                    "Falha ao gerar preview da marca d'água:",\n                    error\n                );\n\n                return {\n                    ok: false,\n                    error:\n                        error instanceof Error\n                            ? error.message\n                            : "Não foi possível gerar o preview."\n                };\n            }\n        }\n    );\n\n'''
if '"watermark:preview"' not in t:
    t = replace_once(t, anchor2, handler + anchor2, "preview IPC")
p.write_text(t, encoding="utf-8")

# preload.js
p = Path("src/main/preload.js")
t = p.read_text(encoding="utf-8")
old = '''        selectWatermark: () =>\n            ipcRenderer.invoke(\n                "watermark:select"\n            ),\n\n        saveWatermarkStyle: (style) =>'''
new = '''        selectWatermark: () =>\n            ipcRenderer.invoke(\n                "watermark:select"\n            ),\n\n        getWatermarkPreview: (filePath) =>\n            ipcRenderer.invoke(\n                "watermark:preview",\n                filePath\n            ),\n\n        saveWatermarkStyle: (style) =>'''
t = replace_once(t, old, new, "preload preview api")
p.write_text(t, encoding="utf-8")

# renderer
p = Path("src/renderer/src/WatermarkSettingsTab.tsx")
t = p.read_text(encoding="utf-8")
start = t.index('    useEffect(() => {\n        if (!draft.filePath) {')
end = t.index('\n    function patch(', start)
new_effect = '''    useEffect(() => {\n        let cancelled = false;\n\n        if (!draft.filePath) {\n            setPreviewUrl("");\n            return () => {\n                cancelled = true;\n            };\n        }\n\n        const api = (window as any).santtosAPI;\n\n        if (!api?.getWatermarkPreview) {\n            setPreviewUrl("");\n            setStatus(\n                "Preview da marca d'água indisponível nesta versão."\n            );\n            return () => {\n                cancelled = true;\n            };\n        }\n\n        api.getWatermarkPreview(draft.filePath)\n            .then((result: any) => {\n                if (cancelled) {\n                    return;\n                }\n\n                if (!result?.ok || !result?.dataUrl) {\n                    setPreviewUrl("");\n                    setStatus(\n                        result?.error ??\n                            "A marca d'água salva não pôde ser carregada. Selecione a imagem novamente."\n                    );\n                    return;\n                }\n\n                setPreviewUrl(result.dataUrl);\n\n                setStatus((current) =>\n                    current.includes("caminho inválido") ||\n                    current.includes("preview")\n                        ? ""\n                        : current\n                );\n            })\n            .catch((error: unknown) => {\n                if (cancelled) {\n                    return;\n                }\n\n                console.error(\n                    "Falha ao carregar preview da marca d'água:",\n                    error\n                );\n                setPreviewUrl("");\n                setStatus(\n                    "Não foi possível carregar o preview da marca d'água."\n                );\n            });\n\n        return () => {\n            cancelled = true;\n        };\n    }, [draft.filePath]);\n'''
t = t[:start] + new_effect + t[end:]
p.write_text(t, encoding="utf-8")
print("watermark preview IPC patch applied")
