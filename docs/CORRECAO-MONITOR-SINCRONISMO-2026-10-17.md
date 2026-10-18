# Monitor local: recuperação de travadas sem desvio persistente de áudio

Relato de 17/10/2026: arquivo local, imagem e som no próprio Santtos; áudio adiantado depois de uma travada. O arquivo e os logs dessa ocorrência não estão disponíveis, portanto esta revisão não identifica de forma conclusiva a causa daquele evento específico.

## Fragilidade encontrada e correção

O monitor recebia JPEG e PCM separadamente, sem posição de mídia compartilhada. O som era concatenado usando `nextStart`. Perdas de pacotes durante bloqueios da interface podiam encurtar essa linha de tempo. Reposicionar `nextStart` também não cancelava todos os `AudioBufferSourceNode` já agendados. A imagem assíncrona podia concluir e desenhar um quadro antigo depois de uma recuperação.

Agora os pacotes carregam identidade do serviço, geração do decoder, posição relativa na mídia e instante de emissão. O JPEG carrega sua posição real pelo índice do tap e a posição corrente de PROGRAM; entregar um JPEG atrasado não o torna atual. O PCM usa contagem contínua de amostras, inclusive quando uma entrega ao monitor é descartada.

O monitor tem um relógio comum de apresentação para imagem e áudio, com reserva local de 120 ms. Essa reserva atende os dois sinais, não é um ajuste fixo de atraso entre áudio e vídeo. O agendamento usa o relógio de saída do AudioContext quando disponível e considera a latência base na alternativa. Pacotes perdidos deixam lacunas, em vez de adiantar os blocos seguintes.

Se nenhum quadro for apresentado por 150 ms, o supervisor local cancela o som agendado e invalida os bitmaps antigos. A retomada aguarda uma imagem válida. Também são rejeitados pacotes envelhecidos, gerações anteriores e JPEGs com conteúdo defasado. Mudanças na referência temporal da fonte realinham as duas trilhas. Uma identidade nova permite recuperar corretamente quando o serviço reinicia e reutiliza contadores baixos.

As filas locais são limitadas: um JPEG pendente para decodificação, até oito bitmaps preparados, PCM pendente limitado a 32 pacotes e janela temporal de validade. Não se recria uma fila de segundos para reproduzir depois da travada. Ao trocar de decoder, callbacks PCM do deck anterior são ignorados.

O relógio local não controla o relógio do PROGRAM nem pausa NDI/OMT/SRT/RTMP por causa de lentidão do canvas. Uma falha apenas do monitor pode produzir silêncio/ausência de quadros localmente durante a recuperação. A capacidade e o sincronismo dos receptores físicos continuam sujeitos à homologação própria.

## Verificação

- `node scripts/test-program-monitor-clock.js`: posições compartilhadas, pacote PCM perdido, atraso de IPC, JPEG atrasado, bitmap assíncrono antigo, cancelamento após travada, mudança de geração, mudança temporal da fonte e reinício do serviço.
- `DISPLAY=:98 node scripts/run-native-qa.cjs --monitor-only`: Electron real, arquivo local, AudioContext/BufferSource e canvas; atraso de 650 ms em `createImageBitmap`, seguido de bloqueio de JavaScript por 650 ms. Confere cancelamento do som, retomada, continuidade do mesmo decoder e correspondência entre blocos PCM e quadros apresentados. O tom de teste usa 997 Hz para identificar blocos por seus samples.
- `npm test` e integração Electron completa verificam as regressões.

No primeiro ensaio compacto aprovado, a diferença máxima de agendamento após a recuperação foi de 1,1 ms em 33 pares PCM/vídeo identificados. Esse número mede o agendamento lógico no ensaio Linux/DEV NULL; não mede alto-falante, dispositivo Windows, tela ou receptor vMix. A verificação final deve repetir o arquivo que falhou e um material de flash/bip no computador da TV.

O ensaio também passou com `SANTTOS_QA_RESOLUTION=1920x1080 SANTTOS_QA_FPS=60`, registrando diferença máxima de agendamento de 9,7 ms em 84 pares após a recuperação. A fonte sintética é compacta e ampliada para a saída; isso não representa um benchmark de decodificação de todos os formatos Full HD/4K.

Na integração completa foi corrigido um defeito do teste de avanço da Opec ao atravessar meia-noite: a rotina de teste consultava a data corrente novamente a cada aplicação, podendo ler outra grade. O ensaio agora mantém a data da sua própria fixture. A regra de datas da programação do produto não foi alterada por essa correção do teste.

Resultado final: `npm test`, o ensaio específico em 1080p60 e a sequência Electron completa passaram. A sequência inclui A/B/HLS local, escuta da Biblioteca, aplicação Opec, falha de disco, recuperação do serviço, arquivos corrompidos, retomada de posição/pausa/FRZ após reinício, configuração das saídas durante reprodução, SRT sem NDI e aplicação por data. O coletor prolongado de 24/72 horas e a verificação física no Windows continuam pendentes.
