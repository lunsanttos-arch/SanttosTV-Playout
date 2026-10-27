# Monitor local e origem dos relógios entre processos

O diagnóstico enviado às 17:23:53 UTC de 27/10/2026 mostra Coelho Branco em PLAYING, a aproximadamente 173 segundos, com 10.348 quadros entregues, cache local ativo e sem lastFailure. A pausa de leitura do pipe de vídeo, com seis quadros na fila e pacer não bloqueado, é controle de fluxo, não o botão Pause. O usuário confirmou que o congelamento estava somente no PROGRAM do Santtos, enquanto o vMix recebia normalmente.

O JSON é uma captura estática do backend: não prova que o canvas da interface atualizou. Os erros anteriores de memória do FFmpeg e o erro de conexão da saída SRT não demonstram a causa desse congelamento local. O arquivo em execução nesse diagnóstico já é diferente do registro interrompido do Walkabout.

## Correção e verificação

Foi verificado um caso reproduzível de rejeição permanente do monitor: os timestamps enviados por um serviço PROGRAM reiniciado podem ter origem civil diferente da interface, especialmente se o relógio do sistema mudou entre o início dos processos. A apresentação usava `performance.timeOrigin + performance.now()` de processos separados diretamente como se seus valores fossem idênticos. Uma diferença superior à janela de frescor rejeitava imagem e áudio locais mesmo com o decoder normal.

O monitor agora faz uma consulta de relógio por identidade do serviço, mede a ida e volta e calcula o deslocamento entre os domínios. Amostras com ida e volta superior a 100 ms são recusadas e tentadas novamente, sem acumular solicitações. A correção é aplicada em conjunto aos timestamps de imagem e áudio do monitor. Não muda o clock do decoder, os samples, os arquivos, NDI/OMT/SRT, a playlist ou as regras de avanço.

A calibração vem de uma consulta atual, não da chegada de um pacote de mídia: mensagens realmente antigas continuam rejeitadas. A identidade de serviços aposentados continua bloqueada. Não se atribui automaticamente essa causa ao PC do operador: o primeiro JSON não continha as informações da interface necessárias para confirmá-la.

O diagnóstico exportado passa a incluir o estado local: quadros desenhados/rejeitados, idade e tempo do último desenho, diferença entre relógios, idade do último pacote, posição mostrada no canvas e erro de decodificação da imagem. A leitura tem prazo de um segundo para não impedir a exportação se a própria interface não responder.

## Testes

- Relógio puro: origens com +5 s e -7 s, deadline comum de imagem e áudio, rejeição de mensagens velhas e de serviços anteriores.
- Electron real, 1920×1080 a 59,94 fps: mudança de domínio de +5 s nas mensagens, recuperação de canvas e Web Audio, mantendo PID e geração do decoder.
- Renderização de bitmap sustentada em 80 ms e os testes existentes de minimizar/sobrepor, navegação, atraso de ACK, congelamento temporário da interface, mute local e falha real de decoder.
- TypeScript, build e verificações existentes da interface.

O teste de bitmap lento também passou antes da calibração; por isso a lentidão, isoladamente, não foi apresentada como causa confirmada. A validação no Windows do operador continua necessária. Se o sintoma persistir, o próximo JSON permitirá distinguir rejeição por relógio, ausência de frames na interface e erro de desenho.
