const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "renderer", "src", "App.tsx");
const mainPath = path.join(root, "src", "renderer", "src", "main.tsx");
const settingsPath = path.join(root, "src", "renderer", "src", "BroadcastSettingsPanel.tsx");
const librarySettingsPath = path.join(root, "src", "renderer", "src", "LibraryFolderSettingsTab.tsx");
const electronMainPath = path.join(root, "src", "main", "main.js");
const rendererIndexPath = path.join(root, "src", "renderer", "index.html");
const packagePath = path.join(root, "package.json");
const appIconPath = path.join(root, "build-resources", "icon.ico");
const brandDir = path.join(root, "src", "renderer", "public", "brand");
const distIndex = path.join(root, "dist", "index.html");
const distAssets = path.join(root, "dist", "assets");

const app = fs.readFileSync(appPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
const librarySettings = fs.readFileSync(librarySettingsPath, "utf8");
const electronMain = fs.readFileSync(electronMainPath, "utf8");
const rendererIndex = fs.readFileSync(rendererIndexPath, "utf8");
const packageConfig = JSON.parse(fs.readFileSync(packagePath, "utf8"));

assert(fs.existsSync(appIconPath), "Ícone oficial do Santtos Playout deve existir para o build Windows.");
assert(fs.existsSync(path.join(brandDir, "logo-horizontal.webp")),
    "Logo horizontal oficial deve existir no renderer.");
assert(fs.existsSync(path.join(brandDir, "logo-symbol.webp")),
    "Símbolo oficial deve permanecer disponível como asset.");
assert(fs.existsSync(path.join(brandDir, "logo-vertical.webp")),
    "Logo vertical oficial deve permanecer disponível como asset.");
assert(app.includes('src="./brand/logo-horizontal.webp"') &&
    app.includes('alt="Santtos Playout"'),
    "Cabeçalho deve usar o logo oficial Santtos Playout.");
assert(packageConfig.build?.directories?.buildResources === "build-resources" &&
    packageConfig.build?.win?.icon === "icon.ico" &&
    packageConfig.build?.win?.executableName === "SanttosTVAutomation",
    "Build Windows deve usar o ícone oficial e nome estável do executável.");
assert(packageConfig.build?.nsis?.oneClick === false &&
    packageConfig.build?.nsis?.createDesktopShortcut === true &&
    packageConfig.build?.nsis?.createStartMenuShortcut === true,
    "Instalador NSIS deve criar atalhos e permitir instalação assistida.");
assert(packageConfig.build?.nsis?.installerIcon === "icon.ico" &&
    packageConfig.build?.nsis?.uninstallerIcon === "icon.ico" &&
    packageConfig.build?.nsis?.installerHeaderIcon === "icon.ico",
    "Instalador, desinstalador e cabeçalho NSIS devem usar o ícone oficial.");
assert(electronMain.includes("resolveAppIcon") &&
    electronMain.includes('"../../build-resources/icon.ico"') &&
    electronMain.includes("process.resourcesPath"),
    "Janela Electron deve usar o ícone oficial em desenvolvimento e empacotado.");

assert(!settings.includes("Engine atual") &&
    !settings.includes("1920×1080 · 29.97p · BGRA"),
    "Configurações não devem exibir um perfil NDI hardcoded.");
assert(!settings.includes('label="Pixel format"'),
    "Pixel format não deve aparecer como configuração operacional.");
assert(settings.includes("tabHeading") &&
    settings.includes('title: "Biblioteca"') &&
    settings.includes('title: "Marca d\'água"') &&
    settings.includes('title: "Identificação no vídeo"'),
    "Título de Configurações deve acompanhar a aba ativa.");
assert(!settings.includes("Resolução, FPS, varredura, aspect ratio e pixel format são aplicados ao PROGRAM NDI"),
    "Aviso redundante sobre aplicação das configurações ao NDI deve ser removido.");


assert(!app.includes('{ panel: "library"'), "Biblioteca não deve voltar ao menu lateral.");
assert(app.includes("persistent-playout-view"), "Playout persistente deve continuar montado na navegação.");
assert(!app.includes('panel: "playlist"') &&
    !app.includes('label: "Playlist"'),
    "Playlist separada deve ser removida; a Timeline é a lista operacional.");
assert(app.includes('RESTANTE{" "}') &&
    app.includes("selectedClipDuration -"),
    "Timer do player deve operar em contagem regressiva.");
assert(app.includes('placeholder="Pesquisar em toda a Biblioteca..."') &&
    app.includes('activeCategoryId === "__all__"') &&
    app.includes("const source = normalized") &&
    app.includes("? libraryMedia"),
    "Pesquisa da Biblioteca deve ser global e incluir todas as pastas.");
assert(app.includes("Somente o item que está efetivamente NO AR é preservado.") &&
    app.includes("setTimelineQueue([") &&
    app.includes("selectedMedia,") &&
    app.includes("...prepared"),
    "Aplicar Programação deve substituir a Timeline preservando somente o item NO AR.");

assert(app.includes("OpecSchedulerPanel") && app.includes('label: "Programação"'),
    "Programação diária deve permanecer integrada ao Playout.");
assert(app.includes("buildPlannedSchedule") &&
    app.includes("programmedStartTime"),
    "Tela principal deve manter horários programados independentemente do estado do player.");

assert(app.includes("ProgramAudioMeters") &&
    app.includes("nativeOutputEnabled") &&
    app.includes("audioStatus={audioStatus}"),
    "Barras L/R devem aparecer ao lado da tela com dados do PCM NDI ou prévia.");
const meter = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "ProgramAudioMeters.tsx"), "utf8"
);
assert(meter.includes("createMediaElementSource") &&
    meter.includes("audio.leftDb") && meter.includes("audio.rightDb"),
    "Áudio da prévia e áudio PCM nativo precisam ter canais L/R independentes.");
assert(meter.includes("if (!mediaUrl) return;") &&
    !meter.includes("if (nativeOutput || !mediaUrl) return;"),
    "O monitor da prévia deve continuar funcionando mesmo com NDI ativo/antigo.");
assert(meter.includes("const pcmAvailable = nativeOutput &&") &&
    meter.includes("PRÉVIA · ") && meter.includes("NDI ANTIGO") &&
    meter.includes("PRÉVIA ≠ NDI"),
    "Ao faltar PCM, exibir níveis de prévia sem alegar que o NDI recebeu áudio.");
assert(meter.includes("audio.nativeActive === true") &&
    meter.includes("NDI SEM ACK"),
    "A UI só pode chamar de NDI PCM após confirmação do sender nativo.");
assert(meter.includes('audio.state === "NO_TRACK"') &&
    meter.includes('audio.state === "ERROR"'),
    "Falta de faixa e falha no encoder devem ser visíveis junto dos medidores.");

assert(!app.includes("DIAGNÓSTICO DO PLAYOUT") &&
    !app.includes("Exportar diagnóstico"),
    "Painel de diagnóstico deve ser removido conforme solicitação.");
const appCss = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "styles.css"), "utf8"
);
assert(appCss.includes(".program-media-row") &&
    appCss.includes(".program-audio-meters") &&
    appCss.includes(".compact-status-card"),
    "Medidores ao lado da tela e NO AR/PRÓXIMO compactos são necessários.");
assert(appCss.includes("minmax(260px, .72fr)") &&
    appCss.includes("minmax(320px, 1.28fr)"),
    "Preview do PROGRAM deve ocupar aproximadamente metade da largura anterior.");
assert(appCss.includes(".timeline-item {") &&
    appCss.includes("padding: 9px 12px") &&
    appCss.includes(".timeline-meta-row"),
    "Itens da Timeline devem permanecer compactos, mas com área operacional maior.");
assert(app.includes('className="timeline-clip-time"') &&
    app.includes('className="timeline-air-time"') &&
    appCss.includes("color: #ff4f68 !important"),
    "Previsão de tempo da Timeline deve ficar em vermelho na linha inferior.");
assert(!app.includes("timeline-time-legend"),
    "A faixa informativa azul acima da Timeline deve permanecer removida.");

assert(app.includes("prepareBrowserPreview"), "Prévia compatível por FFmpeg deve estar disponível.");
assert(app.includes("onError={(event) =>"), "Falha de reprodução precisa ser visível ao operador.");
assert(app.includes("nativePlayout.state === \"PLAYING\"") &&
    app.includes("onNativePlayoutEnded") &&
    app.includes("pauseNdiFile"),
    "PROGRAM deve ser controlado pelo motor nativo, incluindo pausa e fim de bloco.");
assert(app.includes("program-progress-slider") &&
    app.includes("seekProgram") &&
    app.includes("seekNdiFile"),
    "Player próprio deve oferecer seek ligado ao motor Santtos.");
assert(app.includes("MOTOR SANTTOS · NDI ATIVO") &&
    app.includes("MOTOR SANTTOS · PAUSADO"),
    "Operador deve enxergar claramente o estado do motor nativo.");
assert(app.includes("PROGRAM nasce no motor nativo") &&
    !app.includes("Verificar primeiro se o Chromium consegue reproduzir a fonte."),
    "Chromium deve ser somente prévia; não pode autorizar o PROGRAM.");
assert(!app.includes('src={selectedMediaUrl}\n                                    controls'),
    "Monitor Chromium não deve expor controles próprios concorrendo com o motor Santtos.");
assert(app.includes("distributeParts"), "Editor de filmes deve oferecer número variável de blocos.");
assert(app.includes("partCount"), "Editor de filmes deve permitir seleção de 1 a 6 blocos.");
assert(app.includes("durationText") && app.includes('label="DURAÇÃO"'),
    "Editor de filmes deve permitir personalizar a duração de cada bloco.");
assert(app.includes("compensateFollowingBlocks") &&
    app.includes("remainingSeconds * (weight / Math.max(1, remainingWeight))"),
    "Ao alterar um bloco, o tempo restante deve ser redistribuído para caber no FINAL GERAL.");
assert(app.includes('field === "inText"') &&
    app.includes("selected.durationText = formatEditorTime(end - start)"),
    "Alterar IN/OUT deve atualizar a duração imediatamente.");
assert(app.includes("compensateLastBlock") &&
    app.includes("o bloco anterior absorve a diferença"),
    "O último bloco deve compensar para trás e manter o FINAL GERAL.");
assert(app.includes("describeForecast"), "Timeline deve exibir tempo restante e horário previsto.");
assert(app.includes("buildTimelineForecast") && app.includes("forecastRunning"),
    "A previsão deve depender do PROGRAM em execução.");
assert(app.includes("sampledAtMs: lastProgressRef.current.atMs"),
    "O horário absoluto não pode oscilar entre amostras do vídeo.");
assert(app.includes("programmedEndAtMs") &&
    !app.includes("timelineClock + delay * 1000"),
    "Relógio de entrada deve reutilizar ETA real e não o cálculo antigo.");
assert(app.includes("forecastRunning") &&
    app.includes("Math.abs(timelineClock - lastProgressRef.current.atMs) <= 4000"),
    "Previsão ESTIMADA deve invalidar dados obsoletos, sem apagar o horário PROGRAMADO.");
assert(app.includes("toggleTimelineFreeze") &&
    app.includes("timeline-freeze-button") &&
    app.includes("holdLastFrame") &&
    app.includes("freezeHoldItemId"),
    "Timeline deve oferecer FREEZE no último frame e manter estado operacional até liberação.");
assert(app.includes("selectedMedia.freezeEnd") &&
    app.includes("freezeHoldItemId === selectedMedia.id") &&
    app.includes('? "completed"') &&
    app.includes(': "skipped"'),
    "NEXT deve liberar o FREEZE como conclusão normal, sem marcar o item como pulado.");
assert(appCss.includes(".timeline-freeze-button.active"),
    "Botão FREEZE ativo deve ser visível para o operador.");
assert(app.includes("programmedHasFreeze") &&
    app.includes("programmedFreezeSeconds") &&
    app.includes('"programmed-time-summary has-freeze"') &&
    app.includes('"ATÉ FREEZE"') &&
    app.includes("buildFreezeCountdown") &&
    appCss.includes(".programmed-time-summary.has-freeze > div"),
    "FREEZE futuro deve acender borda vermelha e mostrar contagem até o próximo FREEZE.");
const etaCode = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "timeline-forecast.ts"), "utf8"
);
assert(etaCode.includes("buildPlannedSchedule") &&
    etaCode.includes("blocked-duration") && etaCode.includes("blocked-loop"),
    "Agenda prevista precisa tratar cortes, mídia sem duração e loop.");
const opecEta = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "OpecSchedulerPanel.tsx"), "utf8"
);
assert(opecEta.includes("buildPlannedSchedule") && opecEta.includes("Início programado"),
    "OPEC deve distinguir horário programado de previsão real.");

assert(app.includes("EXHIBITION_OPTIONS"), "Timeline deve sinalizar inédito/reprise/estreia.");
const timelineControlsStart = app.indexOf('className="timeline-gc-controls"');
const timelineControlsEnd = app.indexOf('className="timeline-actions"', timelineControlsStart);
const timelineControlsBlock = app.slice(timelineControlsStart, timelineControlsEnd);
assert(timelineControlsBlock.includes("timeline-watermark-toggle") &&
    timelineControlsBlock.includes("timeline-exhibition") &&
    timelineControlsBlock.indexOf("timeline-watermark-toggle") <
        timelineControlsBlock.indexOf("timeline-exhibition"),
    "Modo de exibição deve ficar na Timeline imediatamente ao lado do Logo.");
assert(app.includes('className="program-exhibition-overlay"'),
    "O identificador editorial deve aparecer sobre a imagem do PROGRAM.");
assert(app.includes("exhibitionType:") && app.includes("normalizeExhibitionType(mediaItem.exhibitionType)"),
    "O tipo de exibicao deve seguir para o engine FFmpeg nativo.");
const exhibition = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "exhibition.ts"), "utf8"
);
const exhibitionSettings = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "ExhibitionSettingsTab.tsx"), "utf8"
);
assert(settings.includes('tab === "exhibition"') && settings.includes("saveExhibition"),
    "Identificação precisa de uma aba editável e de um botão Salvar.");
assert(exhibitionSettings.includes("backgroundEnabled") && exhibitionSettings.includes("fontFamily") &&
    exhibitionSettings.includes("rightOffsetPx") && exhibitionSettings.includes("patchLabel"),
    "Aba precisa configurar fonte, texto, fundo opcional e posição.");
assert(exhibitionSettings.includes("Montserrat") &&
    exhibitionSettings.includes("Poppins") &&
    exhibitionSettings.includes("Roboto Condensed"),
    "Identificação deve oferecer fontes editoriais modernas.");
assert(exhibitionSettings.includes("FieldRange") &&
    exhibitionSettings.includes("Tamanho da fonte") &&
    exhibitionSettings.includes("exhibition-live-preview-compact"),
    "Tamanho/posição devem usar sliders e a prévia deve ser compacta.");
assert(exhibition.includes('textAlign: "center"') &&
    exhibition.includes('transform: "translateX(-50%)"'),
    "Prévia da identificação deve permanecer centralizada no logo.");

assert(app.includes("saveExhibitionStyle") && app.includes("exhibitionPreviewStyle"),
    "Alterações precisam chegar ao monitor do PROGRAM.");

assert(exhibition.includes("exhibitionPreviewAnchor"),
    "A legenda no monitor precisa acompanhar a posicao configurada do logo.");

const opecPath = path.join(root, "src", "renderer", "src", "OpecSchedulerPanel.tsx");
const opec = fs.readFileSync(opecPath, "utf8");
assert(opec.includes("exhibitionType"), "Programação diária deve permitir marcação editorial.");
assert(opec.includes('useState("00:00")') &&
    opec.includes('saved.startTime || "00:00"'),
    "Programação deve começar às 00:00 por padrão.");
assert(app.includes("+ Nova pasta"), "Biblioteca deve oferecer criação de nova pasta.");
assert(app.includes("selectLibraryFolder"), "Criação/configuração deve usar seletor de pasta.");
assert(app.includes("scanLibraryCategory"), "Biblioteca deve conseguir atualizar a pasta ativa.");
assert(app.includes("result.category ?? activeCategory") &&
    app.includes("item.id === result.category!.id"),
    "Atualizar a Biblioteca deve sincronizar o folderPath devolvido pelo backend antes de filtrar as mídias.");
assert(app.includes('"santtos:library-categories-updated"') &&
    librarySettings.includes('"santtos:library-categories-updated"'),
    "Salvar pastas deve sincronizar imediatamente a Biblioteca persistente.");
assert(librarySettings.includes("Pastas da Biblioteca salvas e sincronizadas."),
    "Configurações devem confirmar que a sincronização da Biblioteca foi disparada.");
const watermarkSettings = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "WatermarkSettingsTab.tsx"),
    "utf8"
);
assert(watermarkSettings.includes('label="Tamanho"') &&
    watermarkSettings.includes("RangeField") &&
    watermarkSettings.includes('label="Posição X"') &&
    watermarkSettings.includes('label="Fade"'),
    "Marca d'água deve usar sliders para tamanho, posição e fade.");
const webInputs = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "WebInputsPanel.tsx"),
    "utf8"
);
assert(app.includes("<WebInputsPanel") &&
    app.includes("library-module-switch") &&
    app.includes("INPUT WEB") &&
    webInputs.includes("MÓDULO PREMIUM") &&
    webInputs.includes('value="srt"') &&
    webInputs.includes("HLS / M3U8") &&
    webInputs.includes("sizePercent") &&
    webInputs.includes('type="range"') &&
    webInputs.includes("sanitizePastedUrl") &&
    webInputs.includes("WebInputsErrorBoundary"),
    "Inputs premium devem ficar no topo da Biblioteca e resistir a links colados inválidos sem derrubar o renderer.");
assert(app.includes('sourceType !== "input"') &&
    app.includes("program-live-input-preview"),
    "Input remoto não deve ser tratado como arquivo local no preview.");
assert(
    app.includes("santtos-input://preview/") &&
    app.includes("selectedInputPreviewUrl") &&
    app.includes("program-input-preview-video") &&
    rendererIndex.includes("santtos-input:"),
    "HTTP/HLS devem ter prévia real via protocolo interno FFmpeg permitido pela CSP."
);
assert(
    webInputs.includes("draggable") &&
    webInputs.includes("startInputDrag") &&
    webInputs.includes("application/x-santtos-timeline-item") &&
    app.includes("parseDraggedTimelineItem") &&
    app.includes("application/x-santtos-timeline-item"),
    "Inputs Web devem ser arrastáveis e soltos na Timeline como as demais mídias."
);
assert(
    webInputs.includes("Compatibilidade HTTP") &&
    webInputs.includes("httpReferer") &&
    webInputs.includes("httpUserAgent") &&
    webInputs.includes('className="secondary-button"') &&
    app.includes("inputHttpReferer") &&
    app.includes("inputHttpUserAgent"),
    "Inputs Web devem oferecer identidade HTTP e controles secundários no tema escuro."
);
assert(
    webInputs.includes("Motor do Input") &&
    webInputs.includes('value="vlc"') &&
    webInputs.includes("getVlcInputStatus") &&
    webInputs.includes("VLC detectado") &&
    app.includes("inputEngine"),
    "Inputs Web devem permitir Automático/FFmpeg/VLC e mostrar detecção do VLC."
);
assert(
    app.includes("prepareNdiInput") &&
    app.includes("cancelPreparedNdiInput") &&
    app.includes("remaining <= 5") &&
    app.includes("PRÉ-CARREGANDO INPUT") &&
    app.includes("INPUT PRONTO") &&
    electronMain.includes('"ndi:prepare-input"') &&
    electronMain.includes("Input pré-carregado assumido pelo PROGRAM"),
    "O próximo Input deve ser pré-carregado 5s antes e reutilizado pelo PROGRAM."
);
assert(
    webInputs.includes("const value =") &&
    !/setDraft\([\s\S]{0,220}event\.currentTarget\.value/.test(webInputs),
    "Formulário de Input deve capturar o valor do evento antes do updater React."
);
assert(
    app.includes("program-engine-error-banner") &&
    app.includes("ERRO DO PROGRAM"),
    "Falha do motor deve aparecer com detalhe dentro do monitor do PROGRAM."
);
assert(
    app.includes("devNullSink") &&
    app.includes("DEV NULL SINK — SEM NDI REAL") &&
    electronMain.includes("NDI nativo indisponivel; DEV NULL SINK ativo"),
    "Desenvolvimento sem sender NDI deve manter PROGRAM/Inputs testáveis com status explícito."
);
assert(
    watermarkSettings.includes('className="secondary-button"'),
    "Ação secundária da Marca d'água não deve usar botão branco nativo."
);

const reportingSettings = fs.readFileSync(
    path.join(root, "src", "renderer", "src", "ReportingSettingsTab.tsx"),
    "utf8"
);
assert(settings.includes('tab === "reporting"') &&
    settings.includes("ReportingSettingsTab") &&
    reportingSettings.includes("Escolher pasta") &&
    reportingSettings.includes("Relatorio_Exibicao_AAAA-MM-DD.xml"),
    "Configurações devem permitir escolher a pasta dos relatórios XML.");

assert(app.includes("operation-status-card") &&
    app.includes("SERVIDOR DE ARQUIVOS") &&
    app.includes("INPUT EXTERNO"),
    "Tela principal deve usar o espaço operacional para status da origem e horários.");



const createStart = app.indexOf("async function createCategory()");
assert(createStart >= 0, "Função createCategory não encontrada.");
const createEnd = app.indexOf("async function handleExplorerDrop", createStart);
const createBlock = app.slice(createStart, createEnd);
assert(
    createBlock.indexOf("selectLibraryFolder") >= 0 &&
    createBlock.indexOf("selectLibraryFolder") < createBlock.indexOf("saveLibraryCategories"),
    "Nova aba deve selecionar a pasta antes de ser salva."
);
assert(
    !createBlock.includes("window.prompt") &&
    createBlock.includes("folderNameFromPath") &&
    app.includes("+ Nova pasta"),
    "Nova pasta da Biblioteca deve usar o seletor nativo e não depender de window.prompt."
);
assert(
    !librarySettings.includes("window.prompt") &&
    librarySettings.includes("selectLibraryFolder") &&
    librarySettings.includes("+ Nova pasta"),
    "Configurações da Biblioteca também devem criar pastas sem window.prompt."
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
