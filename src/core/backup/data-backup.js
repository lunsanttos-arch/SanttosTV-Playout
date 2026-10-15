"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const FILES = ["database/santtos-tv.json", "library-categories.json", "web-inputs.json", "server-media.json",
    "reporting/playout-report-state.json", "reporting/playout-report-config.json", "playout-recovery.json", "operation-settings.json"];
const MAX = 128 * 1024 * 1024;
function atomic(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { const fd = fs.openSync(temp, "wx"); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
}
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function validateJson(name, bytes) {
    const data = JSON.parse(bytes.toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error(`Dados inválidos: ${name}`);
    if (name === FILES[0] && (!data.settings || !Array.isArray(data.media) || !Array.isArray(data.timeline))) throw Error("Banco de dados inválido.");
    for (const [file, key] of [[FILES[1], "categories"], [FILES[2], "inputs"], [FILES[4], "entries"]])
        if (name === file && !Array.isArray(data[key])) throw Error(`Dados inválidos: ${name}`);
    if (name === FILES[6] && (typeof data.itemId !== "string" || !Number.isFinite(data.positionSeconds) || data.positionSeconds < 0)) throw Error("Posição de recuperação inválida.");
    return data;
}
function decodeBytes(bytes) {
    if (bytes.length > MAX) throw Error("Backup excede o limite de 128 MB.");
    const packageData = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: MAX }).toString("utf8"));
    if (packageData.format !== "santtos-data-backup" || packageData.version !== 1 || !Array.isArray(packageData.files) ||
        packageData.files.length > FILES.length || !Number.isFinite(Date.parse(packageData.createdAt))) throw Error("Formato de backup inválido ou incompatível.");
    const files = new Map();
    for (const item of packageData.files) {
        if (!FILES.includes(item.name) || files.has(item.name) || typeof item.data !== "string") throw Error("O backup contém arquivos não permitidos.");
        const bytes = Buffer.from(item.data, "base64");
        if (bytes.toString("base64") !== item.data || hash(bytes) !== item.sha256) throw Error(`Integridade inválida: ${item.name}`);
        validateJson(item.name, bytes); files.set(item.name, bytes);
    }
    if (!files.has(FILES[0])) throw Error("O backup não contém o banco de dados.");
    return { files, info: { createdAt: packageData.createdAt, appVersion: String(packageData.appVersion || ""),
        files: [...files.keys()], mediaCount: validateJson(FILES[0], files.get(FILES[0])).media.length } };
}
function decodeBackup(file) {
    if (fs.statSync(file).size > MAX) throw Error("Backup excede o limite de 128 MB.");
    return decodeBytes(fs.readFileSync(file));
}
class DataBackupManager {
    constructor(folder, version = "") { this.folder = folder; this.version = version; this.local = path.join(folder, "data-backups");
        this.configFile = path.join(folder, "data-backup-settings.json"); }
    settings() {
        let saved = {}; if (fs.existsSync(this.configFile)) saved = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
        return { ...saved, enabled: saved.enabled !== false, keep: Math.min(200, Math.max(5, Math.floor(Number(saved.keep) || 30))),
            intervalHours: [1,6,24].includes(saved.intervalHours) ? saved.intervalHours : 1,
            additionalFolder: typeof saved.additionalFolder === "string" && path.isAbsolute(saved.additionalFolder) ? saved.additionalFolder : "",
            installationId: /^[a-f0-9-]{36}$/.test(saved.installationId || "") ? saved.installationId : crypto.randomUUID() };
    }
    configure(patch) { const current = this.settings(); const next = { ...current };
        if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
        if (Number.isInteger(patch.keep) && patch.keep >= 5 && patch.keep <= 200) next.keep = patch.keep;
        if ([1,6,24].includes(patch.intervalHours)) next.intervalHours = patch.intervalHours;
        if (patch.additionalFolder === "" || (typeof patch.additionalFolder === "string" && path.isAbsolute(patch.additionalFolder))) next.additionalFolder = patch.additionalFolder;
        atomic(this.configFile, JSON.stringify(next)); return this.status(); }
    status() { return { settings: this.settings(), localFolder: this.local }; }
    snapshot() {
        let total = 0; const files = [];
        for (const name of FILES) { const file = path.join(this.folder, name); if (!fs.existsSync(file)) continue;
            const size = fs.statSync(file).size; total += size; if (total > MAX / 1.4) throw Error("Os dados excedem o limite do backup.");
            const bytes = fs.readFileSync(file); validateJson(name, bytes);
            files.push({ name, data: bytes.toString("base64"), sha256: hash(bytes) }); }
        if (!files.some(file => file.name === FILES[0])) throw Error("Banco de dados não encontrado.");
        const bytes = zlib.gzipSync(Buffer.from(JSON.stringify({ format: "santtos-data-backup", version: 1,
            createdAt: new Date().toISOString(), appVersion: this.version, files })), { level: 6 });
        if (bytes.length > MAX) throw Error("Backup excede o limite."); return bytes;
    }
    prune(folder, settings) {
        const prefix = `auto-${settings.installationId}-`;
        const files = fs.readdirSync(folder).filter(name => name.startsWith(prefix) && name.endsWith(".santtos-backup"))
            .map(name => ({ name, time: fs.statSync(path.join(folder,name)).mtimeMs })).sort((a,b) => b.time-a.time || b.name.localeCompare(a.name));
        for (const file of files.slice(settings.keep)) fs.unlinkSync(path.join(folder,file.name));
    }
    create() {
        const settings = this.settings(); settings.lastAttemptAt = new Date().toISOString();
        atomic(this.configFile, JSON.stringify(settings));
        try {
            const bytes = this.snapshot(); const name = `auto-${settings.installationId}-${new Date().toISOString().replace(/[:.]/g,"-")}-${crypto.randomUUID()}.santtos-backup`;
            const file = path.join(this.local, name); atomic(file, bytes); settings.lastSuccessAt = new Date().toISOString(); settings.lastError = "";
            this.prune(this.local, settings); settings.additionalError = "";
            // Commit local success before accessing an optional network/removable volume.
            atomic(this.configFile, JSON.stringify(settings));
            if (settings.additionalFolder) {
                try { atomic(path.join(settings.additionalFolder,name), bytes); this.prune(settings.additionalFolder,settings);
                    settings.additionalSuccessAt = new Date().toISOString(); }
                catch (error) { settings.additionalError = `Backup local concluído; cópia adicional indisponível: ${error.message}`; }
            }
            atomic(this.configFile, JSON.stringify(settings)); return { ok: true, file, warning: settings.additionalError, ...this.status() };
        } catch (error) { settings.lastError = error.message; try { atomic(this.configFile,JSON.stringify(settings)); } catch {}
            throw error; }
    }
    export(file) { atomic(file, this.snapshot()); return { ok: true }; }
    inspect(file) { return decodeBackup(file).info; }
    stage(file) { if (fs.statSync(file).size > MAX) throw Error("Backup muito grande."); const bytes = fs.readFileSync(file); if (bytes.length > MAX) throw Error("Backup muito grande.");
        const target = path.join(this.folder,"pending-data-restore.santtos-backup");
        decodeBytes(bytes); atomic(target,bytes); return { ok: true }; }
}
function applyPendingRestore(folder) {
    const pending = path.join(folder,"pending-data-restore.santtos-backup"), journal = path.join(folder,"data-restore-journal.json");
    const rollback = path.join(folder,"data-restore-rollback");
    const recover = () => {
        for (const name of FILES) {
            const old = path.join(rollback,name), target = path.join(folder,name);
            if (fs.existsSync(old)) atomic(target, fs.readFileSync(old)); else fs.rmSync(target,{force:true});
        }
        fs.rmSync(journal,{force:true}); fs.rmSync(rollback,{recursive:true,force:true});
    };
    if (fs.existsSync(journal)) recover();
    if (!fs.existsSync(pending)) return false;
    const { files } = decodeBackup(pending);
    fs.rmSync(rollback,{recursive:true,force:true});
    for (const name of FILES) { const file=path.join(folder,name); if (fs.existsSync(file)) atomic(path.join(rollback,name),fs.readFileSync(file)); }
    atomic(journal, JSON.stringify({ version:1 }));
    try {
        for (const name of FILES) {
            let bytes=files.get(name); const target=path.join(folder,name);
            if (bytes && name===FILES[6]) { const checkpoint=JSON.parse(bytes); checkpoint.playing=false; bytes=Buffer.from(JSON.stringify(checkpoint)); }
            if (bytes) atomic(target,bytes); else fs.rmSync(target,{force:true});
            fs.rmSync(target+".bak",{force:true});
        }
        fs.rmSync(pending,{force:true}); fs.rmSync(journal,{force:true});
        // Keep the previous state as a local safety copy until the next restore.
        return true;
    } catch (error) { recover(); throw error; }
}
class DataBackupService {
    constructor(folder,version,beforeSnapshot=null) { this.beforeSnapshot=beforeSnapshot;this.folder=folder;this.version=version;this.busy=false;this.lastError="";this.timer=null;this.workers=new Set(); }
    run(action,args={}) {
        if (this.stopped) return Promise.reject(Error("Backup interrompido pelo encerramento do aplicativo."));
        if (this.busy && action!=="status") return Promise.reject(Error("Uma operação de backup já está em andamento."));
        if(action!=="status")this.busy=true;
        return Promise.resolve().then(async () => {
            if (["create", "export"].includes(action)) await this.beforeSnapshot?.();
            if (this.stopped) throw Error("Backup interrompido pelo encerramento do aplicativo.");
            return new Promise((resolve,reject)=>{
                const worker=new Worker(__filename,{workerData:{folder:this.folder,version:this.version,action,args}});this.workers.add(worker);
                const timer=setTimeout(()=>{worker.terminate();reject(Error("A operação de backup excedeu o tempo limite. Confira o disco ou a pasta adicional."));},60000);timer.unref();
                worker.once("message",result=>{if(result.error)reject(Error(result.error));else resolve(result.value)});
                worker.once("error",reject);worker.once("exit",code=>{clearTimeout(timer);this.workers.delete(worker);if(code)reject(Error("O processo de backup foi interrompido."));});
            });
        }).then(value=>{if(action!=="status")this.lastError="";return value}).catch(error=>{this.lastError=error.message;throw error}).finally(()=>{if(action!=="status")this.busy=false});
    }
    start() {
        this.stopped=false;
        const tick=async()=>{if(this.busy)return;try{const {settings}=await this.run("status");
            if(settings.enabled && (!settings.lastAttemptAt || Date.now()-Date.parse(settings.lastAttemptAt)>=settings.intervalHours*3600000))
                await this.run("create");}catch(error){console.error("Backup automático:",error.message)}};
        this.initialTimer=setTimeout(()=>void tick(),30000);this.initialTimer.unref();
        this.timer=setInterval(()=>void tick(),60000);this.timer.unref();
    }
    stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.initialTimer);for(const worker of this.workers)void worker.terminate();}
}
if(!isMainThread){try{const manager=new DataBackupManager(workerData.folder,workerData.version);const action=workerData.action;
    if(!["status","configure","create","export","inspect","stage"].includes(action))throw Error("Operação inválida.");
    const arg=action==="configure"?workerData.args:workerData.args.file;
    parentPort.postMessage({value:manager[action](arg)});
}catch(error){parentPort.postMessage({error:error.message})}}
module.exports={DataBackupManager,DataBackupService,applyPendingRestore,decodeBackup,FILES};
