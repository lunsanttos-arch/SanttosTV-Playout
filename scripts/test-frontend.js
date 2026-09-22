const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "renderer", "src", "App.tsx");
const mainPath = path.join(root, "src", "renderer", "src", "main.tsx");
const settingsPath = path.join(root, "src", "renderer", "src", "BroadcastSettingsPanel.tsx");
const distIndex = path.join(root, "dist", "index.html");
const distAssets = path.join(root, "dist", "assets");

const app = fs.readFileSync(appPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");

assert(!app.includes('{ panel: "library"'), "Biblioteca não deve voltar ao menu lateral.");
assert(app.includes("persistent-playout-view"), "Playout persistente deve continuar montado na navegação.");
assert(app.includes("OpecSchedulerPanel"), "Scheduler/OPEC deve estar integrado.");
assert(app.includes("+ Nova aba"), "Biblioteca deve oferecer criação de sub-aba.");
assert(app.includes("selectLibraryFolder"), "Criação/configuração deve usar seletor de pasta.");
assert(app.includes("scanLibraryCategory"), "Biblioteca deve conseguir atualizar a pasta ativa.");

const createStart = app.indexOf("async function createCategory()");
assert(createStart >= 0, "Função createCategory não encontrada.");
const createEnd = app.indexOf("async function handleExplorerDrop", createStart);
const createBlock = app.slice(createStart, createEnd);
assert(
    createBlock.indexOf("selectLibraryFolder") >= 0 &&
    createBlock.indexOf("selectLibraryFolder") < createBlock.indexOf("saveLibraryCategories"),
    "Nova aba deve selecionar a pasta antes de ser salva."
);

assert(main.includes('import "./library-categories.css"'), "CSS das categorias da Biblioteca deve estar carregado.");
assert(settings.includes('"library"') || settings.includes("Library"), "Configurações devem conter suporte à Biblioteca.");

assert(fs.existsSync(distIndex), "Build do frontend não gerou dist/index.html.");
assert(fs.existsSync(distAssets), "Build do frontend não gerou assets.");
const assets = fs.readdirSync(distAssets);
assert(assets.some((name) => name.endsWith(".js")), "Bundle JavaScript não foi gerado.");
assert(assets.some((name) => name.endsWith(".css")), "Bundle CSS não foi gerado.");

const html = fs.readFileSync(distIndex, "utf8");
assert(html.includes('id="root"'), "HTML final não possui o root do React.");

console.log("FRONTEND QA: APROVADO");
console.log("✓ TypeScript/Vite bundle");
console.log("✓ Playout persistente");
console.log("✓ OPEC integrado");
console.log("✓ Biblioteca sem menu lateral");
console.log("✓ sub-abas e seleção obrigatória de pasta");
