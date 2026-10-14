import { useEffect, useState } from "react";
export interface BackupStatus {
    ok?: boolean; canceled?: boolean; error?: string; busy?: boolean; localFolder?: string;
    settings?: { enabled: boolean; keep: number; intervalHours: number; additionalFolder: string;
        lastSuccessAt?: string; lastError?: string; additionalError?: string; additionalSuccessAt?: string };
}
export default function DataBackupSettingsTab() {
    const [state,setState]=useState<BackupStatus>({});const [enabled,setEnabled]=useState(true);
    const [keep,setKeep]=useState(30),[hours,setHours]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
    const [restore,setRestore]=useState<{createdAt:string;appVersion:string;mediaCount:number;files:string[]}|null>(null);
    async function refresh(){const result=await window.santtosAPI.getDataBackupStatus();setState(result);if(result.error)setMessage(result.error);return result;}
    useEffect(()=>{void refresh().then(result=>{if(result.settings){setEnabled(result.settings.enabled);setKeep(result.settings.keep);setHours(result.settings.intervalHours)}}).catch(()=>setMessage("Não foi possível carregar os backups."));const timer=setInterval(()=>void refresh().catch(()=>{}),10000);return()=>clearInterval(timer)},[]);
    async function perform(action:()=>Promise<{ok?:boolean;canceled?:boolean;error?:string;warning?:string}>,success:string){setBusy(true);setMessage("");try{const result=await action();if(!result.canceled)setMessage(result.error||result.warning||success);await refresh()}catch(error){setMessage(error instanceof Error?error.message:"Não foi possível concluir.")}finally{setBusy(false)}}
    const stamp=(value?:string)=>value?new Date(value).toLocaleString("pt-BR"):"Nenhum backup concluído";
    return <div className="broadcast-settings-grid"><section className="broadcast-settings-card">
        <h2>Backup de dados</h2><p>Guarda programação, cadastros, configurações e histórico de exibição. Não copia vídeos nem arquivos do cache.</p>
        <label className="broadcast-setting-field"><span>Backup automático local</span><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.currentTarget.checked)} /></label>
        <label className="broadcast-setting-field"><span>Frequência</span><select value={hours} onChange={e=>setHours(Number(e.currentTarget.value))}><option value={1}>A cada hora</option><option value={6}>A cada 6 horas</option><option value={24}>Diariamente</option></select></label>
        <label className="broadcast-setting-field"><span>Cópias anteriores</span><input type="number" min={5} max={200} value={keep} onChange={e=>setKeep(Number(e.currentTarget.value))}/></label>
        <button disabled={busy||keep<5||keep>200||!Number.isInteger(keep)} onClick={()=>void perform(()=>window.santtosAPI.saveDataBackupSettings({enabled,keep,intervalHours:hours}),"Rotina salva.")}>Salvar rotina</button>
        <p>Último backup local: {stamp(state.settings?.lastSuccessAt)}</p>
        <p style={{overflowWrap:"anywhere"}}>Pasta local: {state.localFolder||"Carregando…"}</p>
        <div className="settings-inline-actions"><button disabled={busy} onClick={()=>void perform(()=>window.santtosAPI.createDataBackup(),"Backup concluído.")}>Criar backup agora</button> <button disabled={busy} onClick={()=>void perform(()=>window.santtosAPI.openDataBackupFolder(),"Pasta aberta.")}>Abrir pasta</button> <button disabled={busy} onClick={()=>void perform(()=>window.santtosAPI.exportDataBackup(),"Backup exportado.")}>Exportar backup</button></div>
        {state.settings?.lastError&&<p role="alert">{state.settings.lastError}</p>}
    </section><section className="broadcast-settings-card"><h2>Pasta adicional opcional</h2>
        <p>Escolha outro disco, pendrive, pasta de rede ou pasta sincronizada. As cópias locais continuam funcionando quando essa pasta estiver indisponível.</p>
        <p style={{overflowWrap:"anywhere"}}>{state.settings?.additionalFolder||"Nenhuma pasta adicional configurada."}</p>
        <button disabled={busy} onClick={()=>void perform(()=>window.santtosAPI.chooseDataBackupFolder(),"Pasta configurada. A próxima cópia será enviada para ela.")}>Escolher pasta</button> <button disabled={busy||!state.settings?.additionalFolder} onClick={()=>void perform(()=>window.santtosAPI.clearDataBackupFolder(),"Pasta adicional removida.")}>Remover pasta adicional</button>
        {state.settings?.additionalFolder&&<p>Última cópia adicional: {stamp(state.settings.additionalSuccessAt)}</p>}
        {state.settings?.additionalError&&<p role="alert">{state.settings.additionalError}</p>}
    </section><section className="broadcast-settings-card"><h2>Restaurar dados</h2>
        <p>A restauração substitui os dados atuais e reinicia o programa. Pare o PROGRAM antes de continuar. Os materiais de mídia e o logo precisam estar nos caminhos cadastrados.</p>
        <button disabled={busy} onClick={()=>void perform(async()=>{setRestore(null);const result=await window.santtosAPI.inspectDataBackup();if(result.info)setRestore(result.info);return result},"Backup validado. Confira os dados antes de restaurar.")}>Selecionar backup</button>
        {restore&&<div><p>Backup de {stamp(restore.createdAt)} · versão {restore.appVersion} · {restore.mediaCount} mídia(s) cadastrada(s).</p>
            <button disabled={busy} onClick={()=>void perform(()=>window.santtosAPI.restoreDataBackup(),"Reiniciando para restaurar…")}>Restaurar e reiniciar</button> <button disabled={busy} onClick={()=>setRestore(null)}>Cancelar</button></div>}
        <p>Depois de restaurar, confira a programação e os caminhos. A reprodução permanece parada.</p>
        <p>Os backups incluem configurações de acesso. Guarde as cópias em local protegido.</p>
    </section>{message&&<p role="status">{message}</p>}</div>;
}
