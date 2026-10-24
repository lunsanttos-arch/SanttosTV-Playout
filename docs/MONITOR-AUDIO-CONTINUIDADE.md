# Continuidade do áudio no monitor local

## Janela de transporte PCM

O adaptador entre o processo PROGRAM e a interface limitava PCM a quatro mensagens aguardando ACK. A 60 fps, isso equivalia a somente 67 ms; durante atrasos normais de IPC, novos pacotes eram descartados antes de chegar ao buffer do monitor. Aumentar apenas a reserva de reprodução não recuperava esses pacotes. OMT permanecia íntegro porque recebe o PCM antes desse transporte.

O limite passou a ser uma janela de até 250 ms de PCM em trânsito, com teto adicional de 64 mensagens e 256 KiB. ACKs liberam a duração e os bytes efetivamente enviados, sem bloquear o motor e sem criar fila ilimitada se a interface parar. O preview continua com crédito independente de um quadro.

A integração Full HD/60 fps atrasa os ACKs de áudio em 120 ms e verifica continuidade das posições e quantidades de amostras recebidas, além de manter os testes de minimização, cobertura, travada e recuperação. O teste unitário cobre 25/30/60 fps, atraso de 150 ms, saturação, retomada e reset. O teste automatizado não substitui a confirmação auditiva no Windows do usuário.

O relato de áudio picotando apenas no PROGRAM local, com OMT limpo no vMix, motivou a revisão do agendamento Web Audio. Cada pacote recalculava sua posição a partir de `getOutputTimestamp()`. Oscilações entre leituras do relógio do dispositivo podiam produzir pequenos espaços e sobreposições, mesmo com PCM consecutivo.

O monitor agora fixa a correspondência com o relógio do dispositivo uma vez por época do relógio compartilhado com o vídeo. Pacotes contíguos seguem uma grade de amostras contínua. Pacotes realmente perdidos preservam sua lacuna; não há concatenação que encurte a linha de tempo. Mudanças de dispositivo/relógio superiores a 80 ms reiniciam o relógio compartilhado de áudio e imagem, em vez de acumular desvio. Cortes, pausa, desligamento do monitor e recuperação após travadas descartam o agendamento anterior.

Essa mudança se limita ao monitor da interface. O PCM enviado às saídas, o nivelador e o motor PROGRAM não foram alterados. O defeito exato no Windows do usuário ainda precisa ser reproduzido e confirmado após atualizar.

Validação: teste de 60 segundos simulando oscilações de 25 ms em 44,1/48 kHz, continuidade entre blocos, perda real de pacotes, troca de época, reinício e salto no relógio. TypeScript/build/frontend passaram. A integração real Electron de monitor verificou recuperação após atraso de bitmap e bloqueio de 650 ms da interface, com cancelamento dos buffers antigos e sincronismo de agendamento após a retomada. Isso não certifica latência física de todos os dispositivos Windows.

## Reserva conforme a latência do dispositivo

A reserva fixa de 120 ms podia ser insuficiente para alguns dispositivos Windows. O monitor usa agora `latencyHint: playback` e uma reserva comum à imagem e ao áudio: pelo menos 250 ms, ou latência base + latência de saída + 120 ms de margem, limitada a um segundo. Ao retomar o AudioContext, a latência é consultada novamente. Uma mudança da reserva reinicia o relógio local dos dois fluxos. As filas de bitmap e PCM também foram dimensionadas para essa reserva; a fila antiga de oito bitmaps não comportava latências maiores.

Testes adicionais cobrem a retenção de PCM durante a reserva sem aceitar pacotes antigos indefinidamente e integração Electron com 400 ms de latência de saída simulada. Continua necessária a confirmação auditiva no dispositivo Windows real. NDI, OMT, SRT e RTMP não recebem esse atraso do monitor local.

## Janela minimizada ou coberta

A janela principal passa a usar `backgroundThrottling: false`, com as opções Chromium `disable-renderer-backgrounding` e `disable-backgrounding-occluded-windows`. O monitor mantém o agendamento PCM e o relógio de imagem mesmo fora de foco, escondido ou minimizado; o mecanismo que cancela áudio em uma travada real do preview continua ativo.

A integração Electron verifica avanço dos agendamentos de áudio e das apresentações de imagem sem cancelamentos durante minimize/hide e durante cobertura por outra BrowserWindow. A continuidade física no Windows depende da confirmação no equipamento; o teste automatizado usa display virtual Linux.
