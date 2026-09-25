# Auditoria do Santtos TV Automation — 24/09/2026

**Escopo:** codigo da branch `audit/security-reliability-2026-09-24` em
comparacao ao `main`, incluindo Electron, renderer, IPC, persistencia,
analisadores FFmpeg, sender NDI, biblioteca, agenda, relatórios, dependencias
e pipeline de QA. Este documento registra achados tecnicos e limites
verificaveis; nao constitui certificacao de seguranca ou homologacao broadcast.

**Implantacao:** somente PR #5 (draft). Nenhum codigo foi instalado no
computador principal da TV nem integrado a `main`.

## Defeitos identificados e tratamento nesta branch

| Area | Achado na versao anterior | Medida aplicada |
|---|---|---|
| Persistencia | Banco JSON escrito diretamente e substituido por base vazia se corrompido | Migracao para userData, escrita atomica, copia .bak, inicializacao bloqueada ao ler base danificada |
| Dados no Windows | Banco criado ao lado dos arquivos da aplicacao empacotada | Banco no diretorio de dados do usuario, com copia nao destrutiva do legado |
| Renderer | `webSecurity:false`, IPC sem verificacao de origem e ausencia de isolamento de navegacao | Sandbox + isolamento de contexto, webSecurity ativo, CSP, bloqueio de navegacao/janelas/permissoes, IPC restrito a janela principal |
| Video local | Renderer acessava arquivos pelo esquema `file://` generico | Esquema `santtos-media:`, limitado a arquivos ja importados e fisicamente existentes |
| Ingest | Importar muitos comerciais iniciava sondagens FFprobe/FFmpeg sem limite de concorrencia | Fila de duas sondagens simultaneas; validacao de frames antes de alocar memoria |
| Relatorios | Estado em JSON substituido diretamente, erro de carga zerava historico, exportacao sem troca atomica | Escrita atomica, .bak, preservacao de dados invalidos; recupera entradas interrompidas como PULADO e reconstitui XLSX desatualizado |
| Biblioteca | Configuracao de pastas gravada diretamente e reiniciada silenciosamente em caso de falha | Escrita atomica, .bak e falha explicita, com recuperacao manual |
| NDI | Processo encerrado sem restart, falha nao detalhada na UI; pacote sem binario | Reinicio com backoff, diagnostico de offline, bloqueio da montagem sem exe/DLL, `extraResources` |
| Decoder | Processo FFmpeg encerrado podia manter o ultimo frame congelado e a UI anunciar ON AIR | Detector de falha, um frame preto para limpar sender, exposicao de erro IPC e status coerente no PROGRAM |
| Instancias | Duas janelas poderiam disputar sender e banco | Single-instance lock do Electron |
| QA | Verificacoes de backend/frontend e smoke, sem testes explicitos de seguranca | Testes de protocolo, isolamento, dados corrompidos e dependencia de producao no workflow Windows |

## Estado real do produto

- **NDI:** sender atual em C++ transmite video BGRA 1920x1080 30000/1001;
  FFmpeg usa `-an`, portanto **nao existe audio nativo no sinal NDI**.
- **SRT:** existem parametros de configuracao, mas **nao existe emissor
  SRT funcional** conectado ao PROGRAM neste codigo.
- **Configuracao de formatos:** interface permite escolher varios formatos,
  mas o sender NDI deste repo permanece fixo em 1080p29.97. Valores salvos
  nao significam que o sender mude de formato.
- **NDI binarios:** `src/core/ndi/ndi_test.exe` e
  `Processing.NDI.Lib.x64.dll` sao gerados/instalados localmente e nao
  estao versionados. Compilar com SDK NDI x64 e validar licenciamento antes
  de produzir um instalador. O build agora bloqueia distribuicao incompleta.
- **Banco:** e JSON (nao SQLite nesta versao). As escritas atomicas protegem
  contra JSON parcial, mas grandes bibliotecas ainda podem causar pausas
  de I/O, especialmente em discos lentos. A proxima evolucao recomendada
  e SQLite com WAL, migracao versionada e backups restauraveis.
- **Dependencias:** o workflow bloqueia advisories de severidade alta
  nas dependencias de producao. Nao equivale a ausencias de moderadas,
  advisories nas ferramentas de build ou falhas no FFmpeg nativo.

## O que o QA prova e o que ainda nao prova

O CI no GitHub Actions (Windows + Node 22) executa:
`npm ci`, verificacao de sintaxe, `npm audit --omit=dev --audit-level=high`,
testes de seguranca, testes funcionais de backend, typecheck/build frontend
e `stress:smoke` com arquivos MP4 sinteticos.

O perfil nomeado `stress:72h` tem 4320 ciclos FFmpeg de duracao limitada,
e **nao** prova uma transmissao real de 72 horas com NDI e audio. O CI nao
executa o exe NDI, nao mede frames perdidos na rede nem sincronismo audio/video.

## Condicoes antes de autorizar uso no ar

1. Executar os testes no Windows de desenvolvimento e criar o EXE nativo
   com DLL compativel e licenciamento verificado.
2. Testar preview de `santtos-media:` com MP4/MOV/MXF, arquivos UNC,
   FAT/NTFS e midias importadas arrastadas. Confirmar o seek e a
   persistencia da grade em reabertura do aplicativo.
3. Forcar corrupcao, falta de energia, falta de espaco em disco, midia
   removida, FFmpeg encerrado e processo NDI encerrado; conferir que
   a grade original permanece intacta e alarmes sao exibidos.
4. Integrar audio PCM ao NDI ou fonte de audio separada comprovadamente
   sincronizada antes de considerar PROGRAM audio/video completo.
5. Validar 24–72 horas **reais** numa bancada com receiver NDI, gravacao,
   medicao de frame drop, freeze, cortes e sincronismo A/V. Manter um
   playout de reserva; nao substituir o sistema de transmissao em producao
   por esta branch antes de aprovar a homologacao.

**Fontes tecnicas de implementacao:**
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/protocol
- https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution
