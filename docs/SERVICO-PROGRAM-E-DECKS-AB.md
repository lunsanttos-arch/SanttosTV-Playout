# Serviço PROGRAM e preparação A/B

Implementação de 15/10/2026. Completa os quatro itens da revisão de arquitetura;
a persistência isolada já havia sido entregue em `030b518`.
O banco JSON, a biblioteca e as programações existentes são preservados.

## Responsabilidades e fluxo

```text
React / OPEC no navegador
          | comandos e estado
Electron principal: janela, HTTP OPEC, diálogos, impressão PDF
          | RPC privado, identificado e limitado
Serviço PROGRAM (Electron utilityProcess, PID próprio)
  relógio e rundown autoritativos
  preparação do próximo item e corte A/B
  FFmpeg -> vídeo bruto + PCM do mesmo decoder
      |               |
  NDI / OMT / SRT / RTMP
      |
  preview JPEG e monitor PCM limitados -> interface
      |
  workers de persistência -> JSON / relatório / checkpoint
```

1. **PROGRAM separado.** `program-runtime.js` executa em processo próprio.
   Electron principal mantém a janela, o servidor HTTP e operações que exigem
   Electron. Nenhum quadro bruto de PROGRAM precisa atravessar a interface.
   Congelar a janela ou bloquear brevemente o processo principal não bloqueia
   o relógio nem a entrega de quadros no serviço.
2. **Persistência isolada.** Workers serializam e gravam documentos com troca
   atômica e confirmação durável. Veja [PERSISTENCIA-ISOLADA.md](PERSISTENCIA-ISOLADA.md).
3. **Dois decks efetivos.** O próximo decoder abre e decodifica vídeo e PCM
   antes do corte. O deck só fica pronto após um quadro completo e áudio
   correspondente; fontes declaradas sem áudio usam silêncio. O corte ativa
   o mesmo processo já preparado, sem reabrir a mídia. Seus buffers são
   limitados e não alimentam a saída nem relatórios antes da ativação.
4. **Antecipação pelo backend.** Um timer de 200 ms consulta a próxima
   ocorrência e o relógio autoritativo. React apenas mostra o preparo.
   Arquivos locais começam o preparo até 15 s antes; entradas remotas aquecem
   conexão até 15 s antes e abrem o decoder até 5 s antes, limitando o atraso
   adicional de uma fonte ao vivo. Itens muito curtos ou fontes lentas podem
   chegar ao corte sem preparo concluído; não há promessa de corte instantâneo
   nessa situação.

O controller deixa de parar o decoder atual antes de solicitar o próximo.
O serviço mantém o atual enquanto prepara o substituto e troca quando este
está pronto. Se o atual já terminou, o mecanismo de standby/contingência
continua responsável pela saída enquanto aguarda.

## Revisões, cancelamento e recuperação

A chave do preparo inclui ocorrência, caminho, posição, IN/OUT, configuração
remota, perfil e revisão das configurações. Trocas de programação e comandos
concorrentes descartam candidatos antigos. Um deck entregue ao PROGRAM sai da
posse do preparador: preparar o próximo nunca mata o decoder que está no ar.
Fontes com término por hora recebem a duração restante no instante da ativação.

RPC tem IDs de resposta, limite de 256 comandos pendentes e timeout padrão de
30 s. Eventos de monitor usam créditos: no máximo um JPEG e quatro mensagens
PCM em trânsito. A confirmação vem do consumidor da interface; uma janela
congelada não acumula indefinidamente esses eventos nem bloqueia PROGRAM.

O processo principal supervisiona heartbeats do serviço. Após ausência de
resposta por 10 s, aplica uma tolerância de 3 s e encerra o processo travado;
se necessário, força o encerramento após mais 1 s. Tenta até três reinícios
automáticos por minuto. A recuperação usa o checkpoint persistido, preserva
PAUSE/FRZ e não reinicia a lista. A ocorrência interrompida por falha fica
registrada no relatório. Travamento do próprio serviço provoca interrupção
até a recuperação; isolamento de processos não equivale a redundância de saída.

## Validação executada

- `npm test`: testes de backend, frontend, controller, persistência, recuperação,
  pacer, PCM, saídas, relatórios e novos contratos de decks/serviço.
- `DISPLAY=:98 npm run test:native-integration`: Electron real com perfil
  descartável e saída DEV NULL, sem alterar programações do usuário.
- HLS ao vivo gerado para o teste: preparo independente de React, vídeo e PCM
  prontos antes do corte, mesmo PID preparado e ativado, avanço ao sucessor.
- Interface congelada e processo principal bloqueado por 800 ms: PROGRAM
  continuou entregando quadros; o teste exige intervalo máximo inferior a 250 ms.
- Serviço PROGRAM suspenso por SIGSTOP: supervisor o encerra, reinicia e
  recupera a ocorrência/posição pelo checkpoint, com registro da interrupção.
- Decoder ativo suspenso: contingência avança e registra o erro; falha real de
  persistência não interrompe vídeo; reinício preserva posição, PAUSE e FRZ.

Esses ensaios Linux validam o funcionamento e os limites testados. A homologação
Windows com receptores físicos NDI/OMT e ensaios contínuos reais de 24/72 horas
continuam necessários antes de certificar operação profissional ininterrupta.

## Correção do monitor após a extração

O ensaio inicial de isolamento contava quadros de PROGRAM, mas não verificava
movimento no canvas. Um teste adicional reproduziu zero mensagens de preview
em 1,2 s enquanto PROGRAM avançava normalmente. FFmpeg pode escrever JPEGs
adiantados pela pipe de monitor; descartar o JPEG mais antigo quando a fila
chegava a quatro removia justamente os quadros que o relógio ainda exibiria.
O próximo JPEG ficava continuamente à frente da posição de vídeo entregue.

A primeira correção preservou JPEGs futuros e pausava a pipe ao atingir oito
quadros. A revisão seguinte identificou que essa pausa podia bloquear as
outras saídas do mesmo FFmpeg. A implementação atual sempre drena JPEG;
retém até 64 quadros/8 MiB, preservando os mais próximos do relógio e descartando
novos previews excedentes. PROGRAM nunca espera o monitor consumir JPEG.
O status informa também descartes e bytes de preview, além da cadência de vídeo.

Além disso, o preload confirma uma mensagem de monitor uma única vez por
conexão, mesmo sem componente React inscrito. Antes, montar/desmontar o
monitor podia deixar um crédito retido, e múltiplos inscritos confirmavam a
mesma mensagem mais de uma vez. A interface congelada continua sem confirmar,
preservando o limite de mensagens em trânsito.

A regressão nativa agora exige pelo menos cinco mensagens de preview em
1,2 s e três imagens diferentes no canvas, além dos testes anteriores de
PROGRAM, áudio, corte preparado e recuperação. O teste de preload cobre
recebimento antes da montagem, múltiplos inscritos e fechamento/reabertura.

## Recuperação de pré-carga e reserva de quadros

Uma pré-carga que falha não é mais reutilizada como resultado definitivo no
corte. O preparador tenta abrir a fonte novamente uma vez, incluindo o caso
em que um decoder ficou pronto e morreu antes de entrar no ar. Cancelamentos
por nova programação continuam sendo cancelamentos; não disparam reconexão.
Uma fonte que também falha na nova abertura segue para a contingência e o
relatório registra a falha definitiva. O timer de preparo não cria uma sequência
ilimitada de processos para uma fonte indisponível.

Entradas remotas só ficam prontas depois de acumular a reserva de vídeo do
pacer (alvo de 250 ms, limitado pelo orçamento de memória/duração) e o PCM
correspondente. Antes, a primeira imagem e uma fração de áudio já liberavam
a ativação, mesmo com o buffer de jitter vazio. Arquivos locais usam alvo de
80 ms de reserva no pacer, em vez do mínimo de dois quadros.

Os encoders rawvideo e MJPEG agora usam explicitamente uma thread por saída;
a decodificação e os filtros mantêm seus limites próprios. Isso evita filas de
codificação dimensionadas automaticamente por número de CPUs durante A/B.
O roteiro de QA aceita `SANTTOS_QA_RESOLUTION` e `SANTTOS_QA_FPS`, permitindo
ensaiar o raster de produção além do perfil compacto. `--inputs-only` executa
os testes de decks/preview e handoff HLS real, incluindo falha de segmento.

Um teste de regressão também reproduz HTTP 403 ao abrir `127.0.0.1` com um
`http_proxy` externo herdado pelo FFmpeg. As URLs estritamente de loopback
(`127.0.0.1`, `localhost` e `[::1]`) agora recebem `-http_proxy ""`, mantendo
as conexões internas no próprio PC. URLs públicas continuam usando sua rota
normal de proxy; autenticação e recusas reais da origem não são contornadas.
O teste usa apenas servidores locais: um fornece mídia e outro simula um proxy
que recusa requisições. Confirma a recusa anterior e a decodificação após a correção.

Na verificação da transmissão Dailymotion `x9xwtpy`, os metadados responderam
HTTP 200, mas a URL recém-renovada do CDN respondeu HTTP 403, inclusive através
do proxy da aplicação. Portanto, renovar links não garante que a origem autorize
a reprodução. O relatório agora identifica explicitamente a recusa do Dailymotion,
em vez de apresentar apenas o endereço local redigido e um erro genérico do FFmpeg.
Nenhum token assinado foi incorporado ao código, à documentação ou aos testes.

## Controle de fluxo da saída nativa

O pipe NDI agora devolve seu estado de escrita ao pacer. Quando está cheio,
o quadro já aceito permanece no pipe e PROGRAM aguarda `drain` antes de
avançar para o próximo, mantendo o áudio preso ao mesmo avanço de quadros.
Uma fila de três quadros deixou de ser motivo para matar e reiniciar o sender.
Erros reais de escrita ainda acionam a recuperação do sender. O standby não
injeta quadros/áudio adicionais enquanto o PROGRAM aguarda o pipe nativo.

Os diagnósticos incluem esperas do pipe NDI, sua maior duração, bytes em fila,
quadros atrasados e maior intervalo de entrega por deck. Isso distingue atraso
do decoder, bloqueio de saída e descarte exclusivamente de monitor.

Novos ensaios: rajada de 12 MB de JPEG antes do vídeo, com 50 quadros PROGRAM
entregues e memória limitada; pipe nativo simulado com atrasos repetidos de
150 ms, preservando ordem e fila de um quadro; ensaio Electron de 60 s em
Full HD com movimento real no canvas e corte de loop A/B. Esses ensaios não
substituem medir o receptor físico Windows do usuário.

Resultados dos ensaios de 60 s: em 1920x1080/29,97 fps houve duas gerações,
115 amostras diferentes do canvas, intervalo máximo de 70,1 ms e um quadro
atrasado por deck no pior caso. Em 1920x1080/59,94 fps: duas gerações,
115 amostras diferentes, máximo de 34,1 ms e dois quadros atrasados por deck.
Atraso nesse contador significa intervalo superior a 1,5 vez o período nominal;
não significa que houve descarte de quadros PROGRAM. Ambos usaram DEV NULL no
Linux. A regressão `npm test` e o ensaio HLS real com falha de segmento passaram.
