# SanTTos Playout — arquitetura de motor 1.0

Este documento registra a migração do motor atual para uma arquitetura de playout broadcast sem interromper a operação existente.

## Princípios

1. **PROGRAM é autoritativo no backend.**
   React nunca decide posição, estado ou relógio do ar.
2. **Um relógio mestre monotônico governa o PROGRAM.**
   Ajustes do relógio civil não podem mover PLAY/PAUSE/SEEK.
3. **Áudio e vídeo devem nascer da mesma origem temporal.**
   O objetivo da próxima fase é uma única abertura/decodificação da fonte.
4. **A saída nunca deve depender da interface.**
   NDI, preview, medidores e futuras saídas são consumidores do PROGRAM.
5. **Troca de mídia deve ocorrer entre decks já aquecidos.**
   O próximo item é preparado antes do CUT.
6. **Falha de conteúdo não pode significar PROGRAM morto.**
   O motor deve avançar ou entrar em contingência.

## Arquitetura alvo

```text
                    ProgramClock
                         |
              +----------+----------+
              |                     |
           DECK A                 DECK B
           ON AIR                PREROLL
              |                     |
              +------ Switcher ------+
                        |
                   Normalizer
                        |
                    PROGRAM BUS
            +-----------+-----------+
            |           |           |
           NDI       Preview      Meters
            |
            +---- SRT / SDI / Recorder (futuro)
```

## Fase 1 — Clock e shell visual

Status: **em implementação**

- `ProgramClock` monotônico baseado em `process.hrtime.bigint()`.
- `NativePlayoutEngine` usa o relógio monotônico.
- relógio civil permanece apenas para programação/horário de entrada.
- nova identidade visual oficial SanTTos aplicada ao renderer.

## Fase 2 — Decoder A/V único

Objetivo:

```text
Fonte -> Decoder único
          |      |
        Video   PCM
          |      |
          +-- PROGRAM --+
```

Eliminar a abertura independente da mesma fonte para áudio e vídeo, reduzindo drift, buffers divergentes e diferenças de seek.

## Fase 3 — Deck A/B

- Deck ativo mantém o item no ar.
- Deck passivo prepara o próximo item.
- Pré-carga deve validar:
  - abertura da fonte;
  - primeiro frame decodificável;
  - áudio/PCM;
  - resolução/FPS;
  - duração;
  - IN/OUT.
- CUT troca a fonte do PROGRAM sem reiniciar a saída NDI.
- Deck liberado prepara N+2.

## Fase 4 — PROGRAM BUS

Separar definitivamente o motor das saídas.

Consumidores previstos:

- NDI;
- preview;
- medidores/monitor de áudio;
- gravador;
- SRT;
- SDI.

Falha de um consumidor não pode derrubar os demais.

## Fase 5 — Media QC

Na importação, classificar a mídia:

- PRONTO PARA O AR;
- NORMALIZAÇÃO NECESSÁRIA;
- PROBLEMÁTICO;
- NÃO RECOMENDADO.

Checar resolução, FPS/VFR, scan, pixel format, codec, sample rate, canais, ausência de áudio, duração A/V, timestamps e primeiro frame.

## Fase 6 — Contingência

Fluxo esperado:

```text
falha -> recuperação curta -> pula item -> filler -> tela de contingência
```

O PROGRAM deve continuar emitindo sinal mesmo quando uma mídia falhar.

## Fase 7 — Hard start / back-timing

Itens podem receber entrada rígida. O scheduler calcula falta/excesso antes do horário e sugere filler ou alerta de estouro.

## Fase 8 — Watchdog

Telemetria interna:

- FPS real;
- frames descartados/atrasados;
- freeze;
- PCM ativo;
- silêncio;
- A/V skew;
- bitrate/reconnects de inputs;
- TR 101 290 para MPEG-TS quando aplicável.

## Regra de migração

Cada fase entra atrás de testes de regressão. O caminho NDI que já está estável não deve ser substituído de uma vez; novos componentes são introduzidos e assumem responsabilidade gradualmente.
