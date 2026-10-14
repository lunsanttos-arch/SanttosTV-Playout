# Revisão de prontidão para uso profissional — 14/10/2026

> Esta auditoria registra o estado anterior às correções. Para o motor e recuperação atuais, consulte [OPERACAO-E-RECUPERACAO.md](OPERACAO-E-RECUPERACAO.md); os gates físicos de liberação estão em [HOMOLOGACAO-WINDOWS.md](HOMOLOGACAO-WINDOWS.md).

Código examinado: `feb46e751752a44ae2644b90e927b211bbcc1c98`. Esta revisão avalia implementação, testes, recuperação, saídas, programação, distribuição e dependências. Nenhum código funcional foi alterado nesta revisão.

## Parecer

A versão atual está adequada para continuar uma bancada ou piloto assistido. Ainda não há evidência suficiente para liberar operação profissional contínua, 24 horas por dia, sem operador. A principal pendência é a autonomia e resistência a falhas do motor, seguida da atualização do runtime e da homologação do pacote Windows.

## Evidência obtida nesta revisão

- A suíte completa `npm test` terminou com código 0 na nuvem Linux, usando Node 24 e `/usr/bin/ffmpeg` e `/usr/bin/ffprobe` (FFmpeg 7.1.5). Inclui frontend, backend, segurança, recuperação, cache, controlador, relatórios, áudio, alinhamento de quadros, prazo OUT, gráficos e encaixe dos blocos.
- Os testes SRT/RTMP receberam H.264 e AAC simultaneamente em loopback, por aproximadamente 10 segundos. Eles usam entrega de quadros temporizada no próprio teste; não homologam toda a operação local/SRT-only da aplicação.
- A regressão de gráficos verifica pixels e quantidade de quadros com 12.033 solicitações. Não equivale a operação contínua em um receptor Windows.
- `npm audit --omit=dev`: 2 entradas moderadas (`exceljs` e sua dependência `uuid`), sem altas ou críticas. É uma cadeia de advisory, não dois defeitos independentes. O advisory de UUID se refere a v3/v5/v6 com buffer; o uso encontrado no ExcelJS é v4. Avaliar alcance e solução compatível antes de trocar dependências.
- `npm audit` completo: 24 entradas afetadas, das quais 12 altas e 2 críticas; esses totais incluem cadeias de dependências. Há advisories altos no próprio Electron e críticos em `shell-quote`/`concurrently`, ferramentas utilizadas pelo início em desenvolvimento.
- Electron instalado: 37.10.3. Consulta ao registro npm retornou 44.7.2 como versão atual. A atualização precisa ser planejada e passar por regressão, não aplicada automaticamente com `audit fix --force`.
- `node scripts/check-native-runtime.js` bloqueia o pacote desta nuvem porque faltam `ndi_test.exe` e `Processing.NDI.Lib.x64.dll`. O bloqueio é correto. Esses arquivos dependem da preparação com SDK/runtime no Windows; isso não prova que estejam ausentes no computador do usuário.
- Não foi gerado nem executado instalador NSIS nesta revisão; os emissores NDI/OMT Windows e receptores em outra máquina não foram executados.

## Pendências antes da liberação

| Prioridade | Pendência e evidência | Critério de aceite |
|---|---|---|
| P0 | Troca de itens depende da interface. `src/main/main.js:2259` conclui o item e envia `playout:native-ended`; `src/renderer/src/App.tsx:2988` solicita o próximo. Não foi encontrado tratamento que reinicie o renderer após falha e mantenha a sequência autonomamente. | A grade, o avanço e os relatórios de execução ficam sob controle do backend. Encerrar/recarregar o renderer na bancada não interrompe nem impede o próximo item; a interface reconecta ao estado real. |
| P0 | Contingência incompleta. `onPlayoutFault`, em `src/main/main.js:316`, entra em FAULT, para SRT/RTMP e envia um único quadro preto para limpar saídas nativas. Não há fluxo contínuo de filler, seleção automática do próximo material válido e supervisor geral de ausência de vídeo/áudio. | Arquivo removido/corrompido, Input sem sinal ou decoder encerrado geram diagnóstico, tentativa limitada e próximo material/contingência contínua. Política configurada pelo master; FREEZE deliberado e silêncio editorial não são confundidos com falha. |
| P0 | Runtime desatualizado. Electron é `devDependency` no projeto, mas constitui o runtime distribuído. A auditoria de produção exclui seus advisories. | Atualizar para versão mantida, revisar as ferramentas de build e repetir os testes de Electron, IPC, protocolos, instalador e emissores. Documentar advisories remanescentes e alcance; CI verifica também o runtime. |
| P0 | Pacote final e emissores ainda sem homologação comprovada. Há source/build NDI e binários OMT, mas a nuvem não executa esses emissores. ONLINE é estado do sender, não prova de recepção. | Compilar runtimes compatíveis, montar NSIS e instalar em Windows limpo sem Node, Git, Vite ou SDK de desenvolvimento. Receber áudio/vídeo NDI e OMT em outro PC e validar todos os perfis oficialmente suportados. Publicar versão identificada, hashes e procedimento de retorno à versão anterior. |
| P0 | Falta ensaio contínuo real. `stress:72h` é 4.320 ciclos FFmpeg acelerados, com `-an` e saída para NUL; não são 72 horas de transmissão nem teste dos receptores. | Rodar 24 h e depois 72 h reais no hardware de produção, com receptores, HLS, arquivos locais, logo/hashtag, aplicação OPEC, pausa/FRZ/seek e saídas simultâneas. Registrar frames, interrupções, A/V, CPU/RAM e crescimento de buffers. |
| P1 | SRT/RTMP sem reconexão no meio do mesmo item. `src/core/playout/transport-output.js:55` registra o encerramento, mas não reinicia o encoder. A reconstrução ocorre quando outro item inicia. As filas em `writeVideo` e `writeAudio` podem descartar vídeo/PCM independentemente sob pressão. | Derrubar e restabelecer destino/rede recupera a saída sem esperar o próximo item e sem afetar outras saídas; política de descarte mantém sincronismo e expõe contadores. |
| P1 | Pacing precisa ser independente da saída. Em `src/main/main.js:2040`, o `FramePacer` é criado no caminho de áudio remoto compartilhado. Arquivos locais dependem da pressão de NDI/OMT; SRT/RTMP não aplicam essa mesma pressão. Isso é risco identificado por inspeção, ainda sem medida de um PROGRAM local em SRT-only nesta revisão. | Testar arquivo local com apenas SRT, apenas RTMP, apenas OMT e todas as saídas. Uma duração conhecida ocupa o mesmo tempo real, sem aceleração, descarte silencioso ou skew. O relógio/entrega não dependem de um receptor auxiliar. |
| P1 | Recuperação após reinício é parcial. Checkpoint atômico existe, mas não há inicialização automática no Windows; a retomada depende de abrir o aplicativo e carregar a interface. | Configurar início automático opcional no master, esperar rede/saídas e retomar checkpoint. Testar fechamento normal, encerramento abrupto, reinício do PC e arquivo ausente. Manter backup externo/restauração da grade e configurações; `.bak` local não substitui backup externo. |
| P1 | CI cobre apenas uma seleção histórica de testes. `.github/workflows/qa.yml` não executa o `npm test` completo e deixa fora regressões recentes como gráficos, encaixe/desfazer, deadline, recuperação, controlador e transportes. | Integrar os testes recentes no CI Windows, executar regressões funcionais do Electron e controlar a compilação/versão dos binários e pacote de release. |

P0 indica condição necessária para declarar a versão profissional contínua. P1 deve ser fechada antes da homologação das funções e modalidades correspondentes; não é autorização para anunciar essas modalidades como homologadas enquanto pendentes.

## Defeito específico encontrado na contingência

`onPlayoutFault` cria `Buffer.alloc(frameSize)`, mas essa rotina atende também I420/UYVY. Zerar todos os componentes não gera preto nesses formatos: os componentes de crominância precisam ser neutros. Um teste FFmpeg com I420 16×16 zerado retornou o pixel RGB `[0,135,0]`; com Y=16 e U/V=128 retornou `[0,0,0]`. O sender NDI já tem `fillBlack` correto em C++, mas o quadro criado no JavaScript para falhas não usa essa normalização. Corrigir e testar a contingência por pixel format faz parte da pendência de operação; nenhuma correção foi aplicada durante esta revisão.

## Evoluções que precisam de medida e escopo

- Pré-carga de Inputs existe, mas o CUT ainda abre o decoder de reprodução. Há um decoder ativo e preparo de entrada; não é implementação completa de dois decks A/B decodificados, com áudio/vídeo prontos para todos os arquivos locais. Medir primeira imagem, buraco de áudio e tempo de corte no receptor. Concluir preroll local/A-B se necessário para cumprir o limite de continuidade definido.
- Fontes locais ainda abrem áudio e vídeo separadamente; o decoder A/V compartilhado é usado no caminho remoto. Unificar a base temporal das fontes locais ou comprovar sincronismo em operação longa, arquivos VFR e após seek/loop/cortes.
- Checkpoint, banco JSON e algumas configurações fazem I/O síncrono no processo principal; checkpoint inclui fsync a cada segundo. Há proteção atômica e backup, mas isso não garante latência sob disco lento ou bibliotecas grandes. Medir importação/salvamento/cache durante o ar, com disco cheio e erro de escrita. Levar persistência pesada a worker/serviço ou banco transacional conforme o resultado.
- Controlador remoto já tem PIN, cookie HttpOnly, expiração, limitação de tentativas e detecção de conflito. É HTTP na rede local. Para acesso externo, definir acesso por VPN ou HTTPS e perfis/permissões adequados. Não anunciar acesso público seguro como função pronta.
- Horários da Programação são referências calculadas a partir do início; não há hard start/back-timing de rede plenamente implementado. Caso o uso inclua entrada rígida em horário civil, definir e homologar essa função antes de oferecê-la.
- Melhorar diagnósticos sem poluir o player: exportar versão/configurações/logs, medir FPS/A-V no receptor e distinguir sender pronto de recepção comprovada. Alarmes úteis para falha real, em painel de diagnóstico separado.
- Atualizar o manual final, formatos oficialmente suportados, requisitos de hardware medidos, rede/firewall, operação OPEC/master, contingência, backup e rollback. A auditoria antiga de setembro e o roteiro de arquitetura registram estados históricos; não devem ser usados como descrição atual da release.

## Ordem recomendada

1. Tornar o PROGRAM autônomo, com contingência e relógio consistente em todas as saídas.
2. Atualizar Electron/dependências e tornar CI/pacote Windows reproduzíveis.
3. Fechar reconexão, início automático e recuperação; medir cortes e sincronismo de fontes locais e remotas.
4. Homologar instalador e NDI/OMT no Windows, depois realizar ensaios reais de 24 h e 72 h.
5. Congelar funcionalidades, documentar limites/rollback e publicar a versão final identificada.

Não é necessário adicionar novas funções de interface para concluir essa etapa. O foco é provar continuidade, previsibilidade e recuperação das funções existentes.
