import {useEffect,useState} from "react";import type {MediaItem} from "./App";
export interface OperationOptions {resumeOnLaunch:boolean;startOnLogin:boolean;watchdogEnabled:boolean;stallSeconds:number;fillerMediaId:string;audioLevelingEnabled:boolean}
export interface OperationStatus {ok:boolean;settings?:OperationOptions;startupAvailable?:boolean;diagnostics?:{lastIssue?:string|null;contingency?:boolean;frameAgeMs?:number|null};error?:string}
export default function OperationSettingsTab(){const [options,setOptions]=useState<OperationOptions>({resumeOnLaunch:true,startOnLogin:false,watchdogEnabled:true,stallSeconds:8,fillerMediaId:"",audioLevelingEnabled:true}),[available,setAvailable]=useState(false),[media,setMedia]=useState<MediaItem[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{void Promise.all([window.santtosAPI.getOperationSettings(),window.santtosAPI.getMedia()]).then(([s,m])=>{if(s.settings)setOptions(s.settings);setAvailable(Boolean(s.startupAvailable));setMedia(m.filter(i=>Number(i.duration)>0));if(s.error)setMessage(s.error)}).catch(()=>setMessage("Não foi possível carregar a operação."))},[]);
 const patch=(value:Partial<OperationOptions>)=>setOptions(current=>({...current,...value}));
 async function save(){setBusy(true);try{const result=await window.santtosAPI.saveOperationSettings(options);setMessage(result.ok?"Operação salva.":result.error||"Não foi possível salvar.")}catch{setMessage("Não foi possível salvar.")}finally{setBusy(false)}}
 return <div className="broadcast-settings-grid"><section className="broadcast-settings-card"><h2>Recuperação</h2>
  <label className="broadcast-setting-field"><span>Retomar o PROGRAM ao abrir</span><input type="checkbox" checked={options.resumeOnLaunch} onChange={e=>patch({resumeOnLaunch:e.currentTarget.checked})}/></label>
  <label className="broadcast-setting-field"><span>Iniciar com o Windows</span><input type="checkbox" disabled={!available} checked={options.startOnLogin} onChange={e=>patch({startOnLogin:e.currentTarget.checked})}/></label>
  <label className="broadcast-setting-field"><span>Reabrir após falha do aplicativo</span><input type="checkbox" disabled={!available} checked={options.watchdogEnabled} onChange={e=>patch({watchdogEnabled:e.currentTarget.checked})}/></label>
  {!available&&<p>Início automático e supervisor externo ficam disponíveis no aplicativo instalado no Windows.</p>}
  <p>O fechamento normal não reabre o programa. Fontes ao vivo retomam o sinal atual; arquivos locais retomam a posição salva.</p>
 </section><section className="broadcast-settings-card"><h2>Contingência</h2><p>Materiais com erro são registrados como PULADO POR ERRO e a sequência avança. Se não houver outro material, entra o vídeo de contingência ou uma tela preta com silêncio.</p>
  <label className="broadcast-setting-field"><span>Vídeo de contingência</span><select value={options.fillerMediaId} onChange={e=>patch({fillerMediaId:e.currentTarget.value})}><option value="">Tela preta</option>{media.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  <label className="broadcast-setting-field"><span>Falha sem novos quadros (segundos)</span><input type="number" min={5} max={60} value={options.stallSeconds} onChange={e=>patch({stallSeconds:Number(e.currentTarget.value)})}/></label>
  <p>FRZ e pausa acionados pelo operador são respeitados. O relatório inclui o motivo e o conteúdo que entrou em seguida.</p>
 </section><section className="broadcast-settings-card"><h2>Nivelamento de áudio</h2>
  <label className="broadcast-setting-field"><span>Nivelar o áudio das saídas</span><input type="checkbox" checked={options.audioLevelingEnabled} onChange={e=>patch({audioLevelingEnabled:e.currentTarget.checked})}/></label>
  <p>Arquivos analisados: alvo de −23 LUFS, com proteção contra picos. Entradas ao vivo e arquivos ainda sem medição usam compressão e limitação.</p>
  <p>Ao salvar, a mudança vale para o próximo material aberto. O arquivo original é preservado.</p>
 </section><section className="broadcast-settings-card"><h2>Diagnóstico</h2><p>Exporte versão, estado do motor e saídas para investigar uma falha.</p>
  <button onClick={()=>{void window.santtosAPI.exportDiagnostics().then(r=>{if(!r.canceled)setMessage(r.ok?"Diagnóstico exportado.":r.error||"Não foi possível exportar.")}).catch(()=>setMessage("Não foi possível exportar."))}}>Exportar diagnóstico</button>
 </section><button disabled={busy||!Number.isInteger(options.stallSeconds)||options.stallSeconds<5||options.stallSeconds>60} onClick={()=>void save()}>Salvar operação</button>{message&&<p role="status">{message}</p>}</div>;
}
