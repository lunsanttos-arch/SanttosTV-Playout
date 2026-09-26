# Monitoramento operacional do playout — teste em bancada

Após uma sessão longa de reprodução sem travamentos observados, esta rodada
acrescenta **instrumentação passiva** para identificar e registrar falhas que
o operador pode não estar olhando no momento.

## O que é medido

- Bytes e quadros **aproximados** produzidos pelo FFmpeg na saída BGRA do
  pipe local que alimenta o processo NDI;
- Tempo desde a última atividade do pipe, estado do processo sender NDI
  e código/erro de finalização do decodificador;
- **DEMORA INICIAL**: após 15 s sem um quadro inteiro desde PLAY;
- **QUADROS PARADOS**: após 8 s sem novos bytes, depois de haver pelo
  menos um quadro. A verificação roda no **processo principal Electron**
  a cada 2 s, inclusive com a janela minimizada;
- **FLUXO RESTABELECIDO** quando o pipe volta a produzir quadros;
- **NDI OFFLINE/RESTABELECIDO** quando o processo sender encerra
  inesperadamente ou volta a anunciar ONLINE.

Os incidentes são gravados somente nas transições de estado, sem
gravar um arquivo novo a cada frame. O histórico NDJSON fica em
`userData/diagnostics/incidents.ndjson`; é limitado a 1 MiB por
segmento, com um segundo segmento anterior. Uma linha incompleta após
queda de energia é ignorada, sem destruir os registros válidos.

No painel **DIAGNÓSTICO DO PLAYOUT** o operador vê o estado e as últimas
ocorrências e pode clicar em **Exportar diagnóstico** para escolher o
destino de um JSON com os eventos recentes, o estado de FFmpeg e se o
processo sender está ativo. Os nomes são apenas os arquivos, não
caminhos completos de origem.

**Limite importante:** contador de bytes e processo NDI ativo **não
provam chegada do sinal no vMix ou outro receiver**. Não monitoramos a
rede nem áudio nesta etapa. O sistema também **não reinicia o vídeo
automaticamente** ao detectar alerta: esse recurso exige testes
específicos de continuidade de sinal antes de entrar em produção.

## Teste local no Windows

Com o aplicativo fechado e o Git sem alterações locais pendentes:

```cmd
git status
git pull --ff-only origin main
npm ci
npm run test:monitor
npm run dev:test
```

Na bancada isolada (`dev:test`), importe um clipe de 30 s e rode-o.
O painel deve exibir **PRÉVIA EM EXECUÇÃO**. Depois, pause: deve mostrar
**BANCADA PARADA**, sem alertar falsamente de congelamento. Clique em
**Exportar diagnóstico**, escolha um local e confira que o JSON indica
`testBench: true` e **não afirma haver saída NDI**.

Em uma **máquina separada do ar**, depois de compilar e instalar o
sender NDI com seu SDK e ter um receiver de teste na rede, abra o app em
modo de desenvolvimento normal. Ao iniciar um clipe, espere
**QUADROS FFmpeg FLUINDO**. Experimente desconectar o receiver:
isso **não** deve ser anunciado falsamente como falha detectada
pela aplicação; o pipe e o sender podem continuar ativos. Durante
um teste controlado, interrompa deliberadamente o sender ou decoder
para conferir as ocorrências. Não faça esse ensaio no computador
de transmissão ativa.

O monitor **não é prova de soak test real de 24–72 h**, mas entrega um
histórico persistente para tornar os próximos testes reproduzíveis.
