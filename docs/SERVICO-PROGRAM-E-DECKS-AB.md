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
