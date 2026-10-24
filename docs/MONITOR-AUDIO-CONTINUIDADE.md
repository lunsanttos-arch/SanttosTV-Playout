# Continuidade do áudio no monitor local

O relato de áudio picotando apenas no PROGRAM local, com OMT limpo no vMix, motivou a revisão do agendamento Web Audio. Cada pacote recalculava sua posição a partir de `getOutputTimestamp()`. Oscilações entre leituras do relógio do dispositivo podiam produzir pequenos espaços e sobreposições, mesmo com PCM consecutivo.

O monitor agora fixa a correspondência com o relógio do dispositivo uma vez por época do relógio compartilhado com o vídeo. Pacotes contíguos seguem uma grade de amostras contínua. Pacotes realmente perdidos preservam sua lacuna; não há concatenação que encurte a linha de tempo. Mudanças de dispositivo/relógio superiores a 80 ms reiniciam o relógio compartilhado de áudio e imagem, em vez de acumular desvio. Cortes, pausa, desligamento do monitor e recuperação após travadas descartam o agendamento anterior.

Essa mudança se limita ao monitor da interface. O PCM enviado às saídas, o nivelador e o motor PROGRAM não foram alterados. O defeito exato no Windows do usuário ainda precisa ser reproduzido e confirmado após atualizar.

Validação: teste de 60 segundos simulando oscilações de 25 ms em 44,1/48 kHz, continuidade entre blocos, perda real de pacotes, troca de época, reinício e salto no relógio. TypeScript/build/frontend passaram. A integração real Electron de monitor verificou recuperação após atraso de bitmap e bloqueio de 650 ms da interface, com cancelamento dos buffers antigos e sincronismo de agendamento após a retomada. Isso não certifica latência física de todos os dispositivos Windows.

## Reserva conforme a latência do dispositivo

A reserva fixa de 120 ms podia ser insuficiente para alguns dispositivos Windows. O monitor usa agora `latencyHint: playback` e uma reserva comum à imagem e ao áudio: pelo menos 250 ms, ou latência base + latência de saída + 120 ms de margem, limitada a um segundo. Ao retomar o AudioContext, a latência é consultada novamente. Uma mudança da reserva reinicia o relógio local dos dois fluxos. As filas de bitmap e PCM também foram dimensionadas para essa reserva; a fila antiga de oito bitmaps não comportava latências maiores.

Testes adicionais cobrem a retenção de PCM durante a reserva sem aceitar pacotes antigos indefinidamente e integração Electron com 400 ms de latência de saída simulada. Continua necessária a confirmação auditiva no dispositivo Windows real. NDI, OMT, SRT e RTMP não recebem esse atraso do monitor local.
