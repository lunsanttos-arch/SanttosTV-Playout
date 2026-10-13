# Gráficos durante a reprodução e testes de estresse

Logo, hashtag e identificação são atualizados no decodificador em execução. Trocar os gráficos não deve alterar a geração do motor, reiniciar o áudio ou cancelar o preparo do próximo Input. O logo é normalizado para PNG no tamanho de saída e os últimos oito resultados ficam em memória; imagens grandes não são decodificadas em cada quadro. Alterações rápidas são agrupadas numa fila limitada, conservando o último valor. Comandos de itens que já saíram do ar são rejeitados.

## Testes automáticos

```sh
npm test
npm run test:live-graphics
npm run stress:quick
```

Na nuvem Linux, selecione os binários compatíveis quando necessário: `FFMPEG_BIN=/usr/bin/ffmpeg FFPROBE_BIN=/usr/bin/ffprobe`.

O teste de gráficos verifica os pixels recebidos, a quantidade de quadros e o intervalo entre quadros em 320×180/25, 640×360/29,97 e 1280×720/60. Faz 12.033 solicitações incluindo cliques repetidos, texto longo/Unicode/caracteres especiais, troca de dimensão da imagem, fontes, posição e identificação. A fila deve conservar o estado final sem erros. O relatório é salvo na pasta temporária como `santtos-live-graphics-results.json`.

## Integração no aplicativo

Os scripts abaixo requerem Electron com depuração em `127.0.0.1:9333`, Vite na porta 5173 e **perfil de QA isolado com DEV NULL**, sem emissor nativo em produção. Eles recusam outros perfis, fazem backup da grade/configurações e restauram ao terminar. O teste OPEC requer um vídeo cadastrado de pelo menos seis segundos.

```sh
node scripts/test-native-live-graphics.cjs
node scripts/test-opec-auto-advance.cjs
SANTTOS_QA_GRAPHICS=1 node scripts/test-input-web-handoff.cjs
SANTTOS_QA_GRAPHICS=1 SANTTOS_QA_STALL=1 node scripts/test-input-web-handoff.cjs
```

O primeiro usa o HLS ao vivo de Porto Alegre, 20 cliques reais de logo e 500 atualizações simultâneas de logo/hashtag/identificação, alteração de imagem/estilo, comando atrasado de item antigo e PAUSE/PLAY. Verifica geração estável durante gráficos e avanço do relógio. Os outros verificam FREEZE explícito, blocos repetidos e aplicação OPEC com Input no ar, incluindo interrupção deliberada de segmentos HLS.

A suíte também verifica recuperação, cache, relatórios, controlador remoto, PCM, alinhamento de quadros e recepção real de vídeo H.264/áudio AAC por SRT e RTMP simultaneamente em loopback. Esses testes têm limites: não equivalem a todas as combinações possíveis, a um ensaio de 72 horas ou à validação dos receptores NDI/OMT no Windows. A bancada Windows permanece necessária para esses emissores.

## Resultado da execução na nuvem (13/10/2026)

- Suíte completa: aprovada; SRT recebeu 10,1 s e RTMP 10,0 s de vídeo/áudio.
- Gráficos: 12.033 solicitações, 920 quadros recebidos nas três saídas testadas, zero erros e zero quadros perdidos. Maior intervalo medido na execução da suíte: 141,5 ms sob carga simultânea; esse valor não é uma promessa de latência para outros computadores.
- Electron/HLS ao vivo: 20 cliques de logo + 500 atualizações simultâneas; geração preservada, 14 comandos efetivos, nenhuma pendência ou erro ao final. Troca de imagem/estilo, rejeição de edição antiga e PAUSE/PLAY aprovados.
- Estresse rápido: 30 ciclos aprovados; máximo de RSS do processo Node aproximadamente 31,1 MiB. Esse valor não inclui o consumo total do Electron/FFmpeg.
- OPEC: aplicação parada e no ar, três materiais de mesma origem e FREEZE explícito aprovados.
- Input Web + gráficos + aplicação OPEC: aprovados com o HLS real normal e com segmentos deliberadamente bloqueados; o OUT avançou para todos os vídeos seguintes.
