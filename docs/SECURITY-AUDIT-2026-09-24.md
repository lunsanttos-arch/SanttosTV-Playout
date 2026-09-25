# Revisão de segurança e confiabilidade — Santtos TV Automation

**Data:** 24/09/2026  
**Código de referência:** `main` em `51666c695b6f47c477db3ef38c0d9414c4926404`.  
**Correções propostas:** PR [#4](https://github.com/lunsanttos-arch/SanttosTV-Playout/pull/4).

## Escopo e metodologia

Leitura dos módulos Electron (main/preload/IPC), React/OPEC, biblioteca, banco JSON, ingestão FFprobe/FFmpeg, sender NDI C++, relatório Excel, scripts de QA, configuração de build e fluxos de navegação. Executados no GitHub Actions Windows: `npm ci`, `npm audit --json`, `npm audit --omit=dev --json`, `npm test`, `npm run stress:smoke` e consulta às versões dos binários FFmpeg/FFprobe. Não é um pentest; o CI não transmite NDI para um monitor físico, não testa instalador empacotado nem valida 24–72 h ao vivo.

## Dependências

| Momento | Total | Altas | Moderadas | Baixas | Produção npm |
|---|---:|---:|---:|---:|---:|
| Lockfile original | 9 | 6 | 2 | 1 | 2 moderadas |
| Após atualização compatível do lockfile | 4 | 2 | 2 | 0 | 2 moderadas |

Atualizações transitivas compatíveis eliminaram alertas de `@xmldom/xmldom`, `fast-uri`, `joi`, `js-yaml` e `nanoid` sem alterar as versões principais declaradas das dependências.

**Pendências remanescentes:**
- **Electron** — alto, dependência direta de desenvolvimento. O audit sugere `44.4.5` (mudança de versão principal). Apesar de estar em `devDependencies`, o Electron constitui o **runtime do aplicativo empacotado**, então esse alerta não pode ser desconsiderado por ficar fora do `--omit=dev`. Atualização exige testes reais no Windows e integração NDI.
- **extract-zip** — alto, dependência transitiva da instalação do Electron. O audit indica resolução pela atualização do Electron; risco relevante sobretudo durante obtenção e extração de dependências.
- **exceljs / uuid** — duas entradas moderadas na árvore de produção. O advisory do `uuid` afeta funções v3/v5/v6 quando um buffer é fornecido; não foi demonstrado um caminho explorável no uso atual do ExcelJS para escrever o relatório. O `npm audit fix --force` sugere um downgrade principal do `exceljs`, não apropriado sem avaliar compatibilidade. Monitorar atualização oficial ou testar override isolado com leitura/escrita de arquivos reais.

**Binários fora do escopo do npm audit:** FFmpeg e FFprobe instalados no CI são 6.1.1 (build de 2023). Verificar CVEs relevantes e planejar atualização com uma matriz de mídia real antes da implantação. O NDI SDK e seu runtime também precisam de política de atualização separada.

## Achados no código e situação

| ID | Área | Evidência e risco | Situação na PR |
|---|---|---|---|
| SEC-01 | Renderer Electron | `webSecurity: false` em `src/main/main.js`; a interface usa URLs locais `file://` para vídeos. Isso desativa proteções de origem e amplia consequências de eventual XSS. O HTML também não define CSP. | **ABERTO (alto)**. Introduzir protocolo seguro de vídeo com range/seek e então reativar `webSecurity`; exigir validação no aplicativo empacotado. |
| SEC-02 | Navegação e IPC | Os handlers IPC confiavam no renderer sem verificar janela/frame; navegação externa e popups não eram explicitamente negados. | **MITIGADO**: handlers passam por guarda de frame principal; frames NDI são validados antes de copiar; janelas extras, navegações e redirects externos são bloqueados. Não neutraliza XSS dentro do documento confiável. |
| SEC-03 | Instância e integridade | Duas instâncias podiam editar o mesmo banco/relatórios e marcar eventos em exibição indevidamente. | **CORRIGIDO** com `requestSingleInstanceLock()` e foco na janela já aberta. |
| DATA-01 | Banco JSON | `src/database/database.js` escrevia diretamente em `../../database` (pasta do projeto e potencialmente empacotamento read-only); gravações não eram atômicas e os testes apagavam o banco em uso temporariamente. | **CORRIGIDO**: `userData/database`, migração da instalação legada quando presente, rename atômico e QA isolado. Fazer backup antes do primeiro upgrade. |
| DATA-02 | Relatório diário | JSON e XLSX eram sobrescritos diretamente. Falha de energia/crash deixava `EM_EXIBICAO` sem conclusão e um XLSX possivelmente incompleto. | **MITIGADO**: escrita temporária+rename, recuperação de eventos abertos como `PULADO` com duração/saída desconhecidas, reconstrução de XLSX faltante/desatualizado ao iniciar. |
| PLAY-01 | Prova de exibição | `EXECUTADO` é decidido por `<video onEnded>` / tempo do preview React; o FFmpeg/NDI não confirma que os frames realmente chegaram ao ar. Um erro de saída pode produzir relatório enganoso. | **ABERTO (alto operacional)**. Mover estado e confirmações de exibição para o engine. |
| PLAY-02 | Saída de TV | FFmpeg produz `-an` e o sender C++ apenas envia vídeo BGRA; não há áudio NDI, A/B pré-carregado, recuperação automática ou heartbeat. Troca de fonte no meio de frame bruto pode desalinhar a entrada do sender. | **ABERTO (alto operacional)**. Arquitetura A/V autoritativa, enquadramento de frames e watchdog antes de 24/7. |
| PLAY-03 | Mídia | Conversão `Number(null)===0` podia mapear vídeo para o stream 0 mesmo quando o índice era desconhecido, e tratar OUT ausente como zero; afetava fontes com áudio antes de vídeo e clipes sem duração. | **CORRIGIDO** na seleção de streams e normalização de IN/OUT. |
| OPS-01 | Instalador NDI | `ndi_test.exe` e a DLL de runtime estão no `.gitignore`, não há etapa de build nativo no `npm run build` nem teste automatizado de conteúdo do instalador. Instalação limpa pode abrir sem NDI. | **ABERTO (bloqueio de distribuição)**. Empacotar engine e runtime conforme licenciamento NDI; validar artefato real. |
| OPS-02 | Biblioteca/ingestão | Leitura síncrona de pastas e `Promise.all` para analisar muitas mídias podem bloquear UI/saturar FFmpeg; sem limites por lote nem controle de fluxo. | **ABERTO (médio operacional)**. Fila limitada, cancelamento, timeouts por pasta e teste com volume real. |
| SEC-04 | Segredos futuros | A senha SRT prevista no banco é armazenada em JSON sem proteção; não existe transmissão SRT ativa nesta versão. `.gitignore` não contemplava arquivos típicos de credenciais. | **PARCIAL**: ignorar arquivos de credenciais; usar DPAPI/armazenamento protegido antes de ativar SRT. |
| SEC-05 | Controle de acesso | A OPEC está embutida no aplicativo local; não há autenticação/autorização por operador. | **ESCOPO FUTURO**: se OPEC ganhar acesso remoto, exigir login, perfis, auditoria e separação do PC de exibição. |

## Verificações e limites

Os testes de regressão atuais cobrem banco, timeline, roteiro, categorias, Excel, TypeScript/Vite e stress smoke sintético de seis ciclos. Foram adicionadas verificações de isolamento IPC, restrições de navegação e prioridade do Áudio 01. Não equivalem a teste de penetração nem confirmam saída NDI, continuidade sem buracos ou sincronismo A/V.

**Importante:** `npm audit --omit=dev` não representa sozinho o risco do executável Electron empacotado, pois o runtime fica registrado como dependência de desenvolvimento.

## Próximas etapas antes de homologar a TV 24/7

1. Criar esquema privado para servir mídia local com seek/range; testar em desenvolvimento e no instalador; ligar `webSecurity: true` e adicionar CSP testada.
2. Atualizar Electron em branch isolada e validar a versão no PC de operação com vídeo real, Biblioteca, OPEC, report XLSX e NDI; revisar os avisos restantes.
3. Incorporar validação de build/assinatura e pacote do `ndi_test.exe` e DLL redistribuível; testar em Windows limpo.
4. Mover `EXECUTADO/PULADO` para eventos reais do engine, adicionar áudio 01, sincronismo A/V, watchdog e caminho de recuperação.
5. Fazer soak test **real** de 24h e 72h com NDI Studio Monitor/captura de saída, alternância, seek, loop, marca d'água, crash e energia.
6. Aplicar limite de concorrência e cancelamento à ingestão; revisar permissões e armazenamento de futuros segredos SRT.
