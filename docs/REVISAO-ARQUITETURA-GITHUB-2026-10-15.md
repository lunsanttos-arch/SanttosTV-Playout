# Revisão de arquitetura com referências do GitHub — 15/10/2026

> Atualização posterior à revisão: o isolamento de gravações foi implementado
> com workers e confirmação durável, mantendo JSON. Consulte
> [PERSISTENCIA-ISOLADA.md](PERSISTENCIA-ISOLADA.md). A extração do serviço PROGRAM,
> os decks A/B e a avaliação de SQLite continuam sendo trabalhos distintos.

## Conclusão

A base React/TypeScript + Node/Electron + FFmpeg + senders C++ é adequada ao
produto. A revisão não justifica trocar todas as linguagens ou adotar outro
playout inteiro. Porém, o isolamento atual ainda não permite declarar que o
PROGRAM está protegido de qualquer tarefa administrativa: entrega de quadros,
timers, banco JSON, início/fim de relatório e controlador HTTP compartilham o
processo principal do Electron.

As prioridades para a versão final são separar o processo de playout, tirar
persistência pesada de seu caminho crítico e implementar preparação efetiva
do próximo decoder. A/B completo continua sendo uma evolução, não uma
capacidade já entregue. Comparação de código e testes curtos não substituem
homologação Windows com receptores reais e ensaio contínuo.

## Método e referências

Foram consultados README e trechos de implementação dos cinco repositórios
abaixo, em clones rasos externos ao projeto. Eles não foram compilados nem
submetidos a benchmark. Sofie e SuperConductor são referências de automação e
controle; não são equivalentes diretos ao nosso decoder/sender integrado.
Nenhum código desses projetos foi incorporado ao SanTTos.

| Projeto / snapshot consultado | Evidência | Aplicação ao SanTTos |
| --- | --- | --- |
| [CasparCG/server](https://github.com/CasparCG/server/tree/db31cf531a5e3e7d260b6aaea8c6838749f8118a) | `src/core/producer/layer.cpp` mantém foreground/background; `stage.cpp` usa executor; `consumer/output.cpp` separa consumidores | Próxima fonte preparada, responsabilidades de entrada/composição/saída separadas |
| [ffplayout/ffplayout](https://github.com/ffplayout/ffplayout/tree/d1eaf848912a4b3a3c6a8cbbbb915884e0bc624e) | `backend/app/src/player/output/playout.rs`, `backend/engine/src/input/live.rs` e `backend/app/src/db/handles/refresh_token.rs`: engine separado, canais limitados e uso de SQLite; testes do banco configuram WAL | Filas limitadas, isolamento de engine, persistência transacional como opção de evolução |
| [Sofie-Automation/sofie-core](https://github.com/Sofie-Automation/sofie-core/tree/d40ae733fefdd831ce614792b65e8434778b2757) | `meteor/server/worker/jobQueue.ts` e `packages/playout-gateway/README.md`: filas de jobs/workers e gateway para equipamentos | Comandos ordenados, processamento fora da interface e contratos claros entre componentes |
| [SuperFlyTV/SuperConductor](https://github.com/SuperFlyTV/SuperConductor/tree/ecaa009cd0c638e0541493a4fa2352d6959920b2) | README descreve cliente e TSR Bridge, inclusive em outra máquina; `shared/packages/server-lib/src/WebsocketServer.ts` implementa comunicação | Separação entre operação e execução é compatível com uma interface Electron/React |
| [OpenBroadcaster/obplayer](https://github.com/OpenBroadcaster/obplayer/tree/a6fee4eafc6617b8616fba68d3e6dd3bafbfb0de) | README, `obplayer/player/control.py` e `obplayer/fallback/fallback_player.py`: pipelines GStreamer, controle concorrente e contingência por prioridades | Contingência precisa de saída final segura, inclusive quando o próprio filler falha |

As escolhas variam: CasparCG usa C++/OpenGL, ffplayout usa Rust/FFmpeg,
OBPlayer usa Python/GStreamer, e as camadas de controle Sofie usam Node/TS.
Não existe uma única linguagem que garanta estabilidade; os pontos comuns
relevantes são controle de concorrência, relógios, buffers e separação de tarefas.

## Proteções confirmadas no SanTTos

- `RundownController`: avanço e relatório controlados pelo backend; loop,
  pausa, FRZ e entrada ao vivo manual possuem tratamentos próprios.
- `ProgramClock`: tempo monotônico; `main.js` injeta esse relógio no engine.
- FFmpeg entrega vídeo e PCM da mesma abertura da fonte; `VideoClockedPcm`
  libera amostras conforme os quadros entregues.
- `FramePacer`: reserva de quadros, limitação por memória e controle de fluxo;
  senders e encoders têm tratamentos de lentidão/reconexão.
- `ProgramStandby`: quadro válido e silêncio quando a fonte não entrega sinal.
- FFmpeg e senders nativos são subprocessos; o renderer tem sandbox e IPC.
- Checkpoint assíncrono, cópia anterior, retomada de ocorrência e posição,
  supervisão de decoder e watchdog externo no Windows instalado.
- Banco usa arquivo temporário, fsync e rename, preservando o original se
  a carga encontrar estrutura inválida. Isso não equivale a uma transação
  única entre banco, relatório e checkpoint, que são arquivos distintos.
- Programação tem controle de versão para evitar sobrescrita silenciosa
  entre operadores; não se trata de ausência total de controle concorrente.

## Defeitos corrigidos nesta revisão

### 1. Falha do filler podia reiniciar a grade que acabara de falhar

O filler usa `__contingency__` e não pertence à timeline. Ao falhar, seu índice
era -1; o cálculo do próximo item apontava para `items[0]`. Uma grade inteira
corrompida seguida de filler corrompido podia ser tentada repetidamente.

Agora a falha do filler encerra a tentativa automática em FAULT e mantém a
saída de segurança disponível. Cada tentativa continua registrada como
`PULADO_POR_ERRO`. Uma retomada manual continua possível.

### 2. Eventos atrasados do mesmo item podiam afetar outra reprodução

`ready` e `fault` validavam o ID do item, mas não a geração do decoder.
Reabrir o mesmo item preserva seu ID e cria outra geração. Agora esses eventos
precisam corresponder também à geração atual. Essa proteção é no controlador;
os callbacks dos subprocessos em `main.js` também verificam sua identidade.

### 3. Parte da bancada selecionava outro FFmpeg

Vários testes chamavam diretamente `ffmpeg-static`, ignorando a seleção de
runtime usada pelo aplicativo. Nesta máquina esse pacote é 7.0.2 e apresentou
SIGSEGV no teste HLS; o aplicativo seleciona o FFmpeg de sistema 7.1.5.
Os testes e o stress passaram a usar `resolveMediaRuntime`, respeitando
`FFMPEG_BIN` / `FFPROBE_BIN` e os mesmos caminhos de seleção da aplicação.
Isso não certifica qualquer binário automaticamente: o gate de runtime e a
homologação do pacote continuam necessários.

## Mudanças estruturais recomendadas, ainda não implementadas

| Prioridade | Evidência atual / risco | Mudança e critério de aceite |
| --- | --- | --- |
| P0 | `main.js` coordena quadros e também tarefas administrativas. `database.saveDatabase` e `playout-report.saveState` fazem serialização, cópia e fsync síncronos | Processo dedicado para o serviço PROGRAM; IPC só com comandos/estado e prévia limitada. Salvar grade grande, gerar PDF e atrasar o disco administrativo não podem bloquear seu relógio de entrega |
| P0 | Banco, relatório e checkpoint têm commits separados; histórico de relatório é regravado inteiro no início/fim da ocorrência | Persistência em worker/processo exclusivo, fila serial e confirmação de durabilidade. Avaliar SQLite/WAL com migração e rollback, ou journal durável incremental. Testar falta de espaço, permissão negada e interrupção entre commits, sem anunciar gravação que não aconteceu |
| P0 | Próxima entrada remota é preparada por `useEffect` em `App.tsx`; se o renderer cair, o avanço continua, mas pode faltar aquecimento | Responsabilidade de preparação no backend, derivada da grade e da ocorrência atual; UI apenas mostra o estado. Testar queda da interface antes da janela de preparo |
| P0 | `InputPrebufferManager` aceita apenas remotos; warm tuner remuxa HLS com `-c:v copy -c:a copy`; decoder final ainda abre no corte | Deck de preparo para arquivos e remotos, com primeiro quadro e áudio prontos no perfil de saída. CUT só aceita deck pronto; timeout segue política explícita. Invalidar preparo por revisão da grade, fonte/IN/OUT e perfil |
| P1 | Composição gráfica ainda pertence ao FFmpeg da ocorrência; prévia JPEG também é produzida nesse processo | Definir contratos de composição e monitoramento; limitar custo da prévia e evitar que monitoramento lento retenha PROGRAM. Medir troca de logo/imagem e texto enquanto várias saídas estão ativas |
| P1 | `main.js` tem mais de 4 mil linhas e concentra integração, transporte, comandos e recuperação | Extrair ProgramService, OutputManager e integração Electron em etapas, com regressões antes de cada extração. Mover arquivos sem separar execução não resolve o bloqueio do event loop |
| P0 de liberação | Testes de Linux DEV NULL não validam descoberta/áudio/vídeo dos SDKs Windows | Instalador Windows limpo, NDI e OMT recebidos em outro PC, SRT/RTMP simultâneos, perda de rede, reinício e 24/72 h reais com métricas externas |

Não é obrigatório migrar para Rust ou C++ para conseguir o primeiro isolamento.
Um serviço Node separado já remove a disputa com banco/UI, desde que tarefas
bloqueantes também fiquem fora desse serviço. Se as medidas no hardware alvo
mostrarem jitter insuficiente, o cadenciamento/bus deve migrar para componente
nativo com filas limitadas. Quadros brutos não devem circular como JSON pelo IPC.

## Arquitetura alvo e ordem de migração

```text
Electron/React + OPEC web
         | comandos, revisão da grade e estado
         v
Serviço PROGRAM dedicado ----- persistência dedicada / journal
         |
    Deck ativo + próximo deck preparado
         |
    seleção de fonte + composição + relógio A/V
         |
    PROGRAM BUS com filas limitadas por consumidor
         +---- NDI / OMT
         +---- SRT / RTMP
         +---- prévia / medidores
```

1. Manter as regressões e correções pequenas desta revisão.
2. Definir protocolo de comandos com ID, ordem, revisão da grade e geração da
   ocorrência; separar persistência e extrair serviço sem trocar o decoder.
3. Tornar preparo autônomo e acrescentar deck B com readiness comprovada.
4. Medir e depois decidir quanto do bus/compositor deve ser nativo.
5. Liberar o instalador após homologação de saídas e longa duração.

Cada etapa precisa preservar retomada, relatório, FRZ, pausa e entradas manuais.
Uma reescrita geral sem essas regressões aumenta o risco de regressão.

## Evidência da bancada desta revisão

Ambiente: Linux, Node 24, FFmpeg/FFprobe 7.1.5; teste de integração Electron
com perfil descartável e saída NDI DEV NULL.

- Regressão nova reproduziu o retorno indevido ao início da grade e a aceitação
  de readiness antiga antes das correções; depois passou, incluindo falha
  antiga ignorada e falha atual avançando normalmente.
- Experimento sintético: bloqueio deliberado de 200 ms no event loop produziu
  intervalo máximo de aproximadamente 221 ms entre quadros a 25 fps (alvo de
  40 ms), sem perder os 15 quadros do experimento. Demonstra o mecanismo de
  atraso; não mede duração real de gravações em disco nem prova que toda
  travada relatada pelo usuário tenha essa causa.
- O primeiro `npm test` parou no SIGSEGV do runtime estático antigo. O teste HLS
  isolado passou após unificar a seleção de runtime; abortar a prévia no teste
  pode registrar fechamento do pipe, conforme o cancelamento deliberado.
- `npm test`: aprovado com a seleção de runtime alinhada. Os testes de named
  pipes NDI e áudio NDI nativo foram pulados por exigirem Windows. O teste OMT
  valida contrato e recuperação, sem certificar SDK ou descoberta em receptor.
- `npm run test:native-integration`: aprovado com Electron real. Incluiu OPEC,
  avanço automático, autonomia após queda do renderer, quatro cenários de
  arquivo corrompido/travado, fechar/reabrir com retomada, pausa, FRZ, grade
  concluída e recepção SRT loopback. O coletor de longa duração foi executado
  somente em smoke de cinco segundos; não foi realizado burn-in de 24/72 h.

Consultar também [HOMOLOGACAO-WINDOWS.md](HOMOLOGACAO-WINDOWS.md) e
[VALIDACAO-0.3.0-rc.1.md](VALIDACAO-0.3.0-rc.1.md). A pesquisa estabelece
prioridades e evidências, sem oferecer garantia de ausência de falhas.
