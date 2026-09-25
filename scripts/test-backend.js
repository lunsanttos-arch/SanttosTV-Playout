const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function waitFor(predicate, timeoutMs = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timeout aguardando resultado assíncrono.");
}

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-tests-"));
    const databaseUserData = path.join(tempRoot, "userData");
    const databaseFile = path.join(databaseUserData, "database", "santtos-tv.json");

    try {
        const db = require("../src/database/database");
        db.initializeDatabase({ userDataPath: databaseUserData });
        assert(fs.existsSync(databaseFile), "Banco deve ser gravado em userData, nao no executavel.");

        const mediaFolder = path.join(tempRoot, "media");
        fs.mkdirSync(mediaFolder, { recursive: true });
        const mp4 = path.join(mediaFolder, "comercial.mp4");
        const txt = path.join(mediaFolder, "ignorar.txt");
        fs.writeFileSync(mp4, Buffer.from([0, 1, 2, 3]));
        fs.writeFileSync(txt, "nao e midia");

        const imported = db.addMedia([mp4, txt]);
        assert.strictEqual(imported.importedItems.length, 1, "Deve importar apenas container suportado.");
        assert.strictEqual(imported.media.length, 1);

        const duplicate = db.addMedia([mp4]);
        assert.strictEqual(duplicate.importedItems.length, 0);
        assert.strictEqual(duplicate.duplicatedItems.length, 1, "Deve detectar duplicata.");

        const source = imported.importedItems[0];
        db.updateMediaMetadata(source.id, {
            duration: 30,
            width: 1920,
            height: 1080,
            fps: 29.97,
            videoCodec: "h264",
            audioCodec: "aac",
            status: "ready"
        });

        const timeline = db.saveTimeline([{
            id: "occ-1",
            sourceMediaId: source.id,
            loop: false,
            watermark: true,
            hashtag: "Teste TV",
            inPoint: 5,
            outPoint: 20,
            blockLabel: "Bloco A",
            exhibitionType: "REPRISE",
            duration: 30
        }]);
        assert.strictEqual(timeline.length, 1);
        assert.strictEqual(timeline[0].hashtag, "#TesteTV");
        assert.strictEqual(timeline[0].inPoint, 5);
        assert.strictEqual(timeline[0].outPoint, 20);
        assert.strictEqual(timeline[0].watermark, true);
        assert.strictEqual(timeline[0].exhibitionType, "REPRISE");
        assert.strictEqual(db.getTimeline()[0].exhibitionType, "REPRISE");

        const rundown = db.saveDailyRundown({
            date: "2026-09-21",
            title: "Roteiro QA",
            startTime: "06:30",
            items: [{
                sourceMediaId: source.id,
                blockLabel: "Break 1",
                notes: "teste",
                exhibitionType: "INEDITO",
                watermark: false,
                hashtag: "#QA",
                inPoint: 0,
                outPoint: 30
            }]
        });
        assert.strictEqual(rundown.items.length, 1);
        assert.strictEqual(rundown.items[0].exhibitionType, "INEDITO");
        assert.strictEqual(rundown.startTime, "06:30");
        assert.strictEqual(db.getDailyRundown("2026-09-21").title, "Roteiro QA");
        assert.strictEqual(db.getDailyRundown("2026-09-21").items[0].exhibitionType, "INEDITO");
        const badAiring = db.saveDailyRundown({
            date: "2026-09-22",
            items: [{ sourceMediaId: source.id, exhibitionType: "QUALQUER" }]
        });
        assert.strictEqual(badAiring.items[0].exhibitionType, "NORMAL");

        const normalizedOutput = db.updateOutputSettings({
            resolution: "1920x1080",
            fps: "29.97",
            scanMode: "progressive",
            aspectRatio: "16:9",
            pixelFormat: "bgra",
            audio: { sampleRate: 48000, channels: 2, bitrateKbps: 192, codec: "aac" },
            ndi: { enabled: true, name: "QA PROGRAM" },
            srt: { enabled: false, mode: "caller", host: "127.0.0.1", port: 9000, latencyMs: 120, videoCodec: "h264", videoBitrateKbps: 8000, maxBitrateKbps: 10000, gopSeconds: 2, preset: "veryfast", audioBitrateKbps: 192 }
        });
        assert.strictEqual(normalizedOutput.ndi.name, "QA PROGRAM");
        assert.strictEqual(normalizedOutput.audio.sampleRate, 48000);

        const configuredExhibition = db.updateExhibitionStyle({
            ...db.getSettings().exhibitionStyle,
            fontSize: 42,
            color: "#eecc44",
            backgroundEnabled: false,
            gapPx: 22,
            labels: { REPRISE: "SEGUNDA EXIBIÇÃO", INEDITO: "ESTREIA HOJE" }
        });
        assert.strictEqual(configuredExhibition.fontSize, 42);
        assert.strictEqual(configuredExhibition.labels.REPRISE, "SEGUNDA EXIBIÇÃO");
        assert.strictEqual(configuredExhibition.labels.INEDITO, "ESTREIA HOJE");
        assert.strictEqual(configuredExhibition.labels.ESTREIA, "ESTREIA");
        assert.strictEqual(configuredExhibition.backgroundEnabled, false);
        assert.strictEqual(JSON.parse(fs.readFileSync(databaseFile, "utf8"))
            .settings.exhibitionStyle.gapPx, 22,
            "Identificação gráfica deve persistir no banco.");
        const sanitizedExhibition = db.updateExhibitionStyle({
            fontSize: 99999,
            color: "invalid",
            labels: { REPRISE: "text='%{evil}'" }
        });
        assert.strictEqual(sanitizedExhibition.fontSize, 100);
        assert.strictEqual(sanitizedExhibition.color, "#ffffff");
        assert.strictEqual(sanitizedExhibition.labels.REPRISE, "REPRISE");
        db.updateExhibitionStyle(configuredExhibition);


        const library = require("../src/core/library/library-categories");
        const userData = path.join(tempRoot, "userData");
        const categoryFolder = path.join(tempRoot, "comerciais");
        fs.mkdirSync(categoryFolder, { recursive: true });
        fs.writeFileSync(path.join(categoryFolder, "A.mp4"), "x");
        fs.writeFileSync(path.join(categoryFolder, "B.MKV"), "x");
        fs.writeFileSync(path.join(categoryFolder, "C.txt"), "x");
        fs.mkdirSync(path.join(categoryFolder, "sub"), { recursive: true });
        fs.writeFileSync(path.join(categoryFolder, "sub", "D.mp4"), "x");

        library.initializeLibraryCategories(userData);
        const defaults = library.getLibraryCategories();
        assert.deepStrictEqual(defaults.slice(0, 4).map((x) => x.name), ["Comerciais", "Chamadas", "Vinhetas", "Drops"]);

        const custom = {
            id: "custom-qa",
            name: "Filmes",
            folderPath: categoryFolder,
            builtIn: false
        };
        library.saveLibraryCategories([...defaults, custom]);
        const scan = library.scanLibraryCategory("custom-qa");
        assert.strictEqual(scan.filePaths.length, 2, "Scan deve aceitar extensões suportadas e ignorar subpastas.");
        assert(scan.filePaths.some((p) => p.endsWith("A.mp4")));
        assert(scan.filePaths.some((p) => p.endsWith("B.MKV")));

        // Salvar segunda geracao: o backup mantem a versao anterior, agora
        // ja contendo a categoria personalizada.
        library.saveLibraryCategories(library.getLibraryCategories());

        // Configuracao danificada nunca pode apagar as abas da biblioteca.
        const categoriesFile = path.join(userData, "library-categories.json");
        assert(fs.existsSync(`${categoriesFile}.bak`));
        fs.writeFileSync(categoriesFile, "{configuracao interrompida", "utf8");
        assert.throws(
            () => library.initializeLibraryCategories(userData),
            /biblioteca danificadas/,
            "Falha de leitura deve preservar categorias sem sobrescrever o original."
        );
        assert.strictEqual(
            fs.readFileSync(categoriesFile, "utf8"),
            "{configuracao interrompida"
        );
        fs.copyFileSync(`${categoriesFile}.bak`, categoriesFile);
        library.initializeLibraryCategories(userData);
        assert.strictEqual(library.scanLibraryCategory("custom-qa").filePaths.length, 2);

        const reports = require("../src/core/reporting/playout-report");
        const docs = path.join(tempRoot, "docs");
        reports.initializePlayoutReports({
            userDataPath: path.join(tempRoot, "report-user"),
            documentsPath: docs
        });
        const entry = reports.startPlayoutEntry({
            id: "occ-qa",
            sourceMediaId: source.id,
            name: "comercial.mp4",
            path: mp4,
            blockLabel: "Break QA",
            inPoint: 0,
            outPoint: 30,
            duration: 30,
            plannedDurationSeconds: 30
        });
        const finished = reports.finishPlayoutEntry(entry.id, "EXECUTADO", 30);
        assert.strictEqual(finished.ok, true);
        assert.strictEqual(finished.entry.status, "EXECUTADO");

        const reportDir = path.join(docs, "Santtos TV", "Relatórios de Exibição");
        await waitFor(() =>
            fs.existsSync(reportDir) &&
            fs.readdirSync(reportDir).some((name) => name.endsWith(".xlsx"))
        );

        assert(fs.existsSync(`${databaseFile}.bak`), "Deve existir backup da geracao anterior.");
        const persisted = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
        assert.strictEqual(persisted.timeline.length, 1, "Timeline nao deve se perder no disco.");
        fs.writeFileSync(databaseFile, "{json interrompido", "utf8");
        assert.throws(
            () => db.initializeDatabase({ userDataPath: databaseUserData }),
            /Banco de programacao invalido/,
            "Nao iniciar com programacao vazia se o arquivo estiver corrompido."
        );
        assert.strictEqual(fs.readFileSync(databaseFile, "utf8"), "{json interrompido");
        fs.copyFileSync(`${databaseFile}.bak`, databaseFile);
        db.initializeDatabase({ userDataPath: databaseUserData });
        assert.strictEqual(db.getTimeline().length, 1, "Backup deve permitir restaurar a timeline.");
        assert.strictEqual(db.getSettings().exhibitionStyle.labels.REPRISE,
            "SEGUNDA EXIBIÇÃO", "Configuração editorial deve sobreviver ao reinício.");
        assert.throws(() => db.getDailyRundown("2026-02-30"), /inexistente/);

        // Historico de exibição corrompido deve bloquear inicializacao.
        const reportUserData = path.join(tempRoot, "report-user");
        const reportStateFile = path.join(reportUserData, "reporting", "playout-report-state.json");
        assert(fs.existsSync(`${reportStateFile}.bak`));
        fs.writeFileSync(reportStateFile, "{historico interrompido", "utf8");
        assert.throws(
            () => reports.initializePlayoutReports({
                userDataPath: reportUserData,
                documentsPath: docs
            }),
            /Historico de exibicao danificado/
        );
        assert.strictEqual(fs.readFileSync(reportStateFile, "utf8"), "{historico interrompido");

        console.log("BACKEND QA: APROVADO");
        console.log("✓ banco e normalização");
        console.log("✓ biblioteca por pastas");
        console.log("✓ timeline e roteiro diário");
        console.log("✓ relatório Excel");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error("BACKEND QA: REPROVADO");
    console.error(error);
    process.exit(1);
});
