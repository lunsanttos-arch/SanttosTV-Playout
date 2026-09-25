# Rodada de teste — Preview, cortes, identificação e horários

Alterações desta rodada: serviço local de mídia com suporte a byte ranges
para `<video>` e seek, diagnóstico explícito de codec/arquivo indisponível,
geração opcional de proxy MP4 H.264/AAC, cortes não destrutivos de 1 a 6
blocos, identificação editorial por ocorrência e horário estimado junto
ao tempo que falta para cada entrada.

## Na mesma pasta do projeto (CMD)

O `git pull` da tentativa anterior parou enquanto o OneDrive mantinha
`.git/objects` bloqueado. Feche o editor, termine a operação pendente com
Ctrl+C, pause a sincronização do OneDrive e **não apague `.git` nem
`stress-report-large.json`**. Depois:

```cmd
git status
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run dev:test
```

Pare se `git status` acusar rebase/merge interrompido, ou se
`git pull` voltar a falhar ao remover `.git/objects`. Se persistir,
a solução é transferir a **pasta existente**, com `.git` e mídias
preservados, para um diretório fora do OneDrive com o aplicativo fechado.

O modo `dev:test` deve exibir **BANCADA ISOLADA — SEM SAÍDA NDI**.
Não é teste de transmissor, nem envia o vídeo para o NDI da TV.

## 1 — Vídeo

- Importe MP4 H.264/AAC **inteiramente disponível no disco** (o OneDrive
  pode mostrar placeholders sem os bytes). Adicione à timeline, selecione e
  clique em reproduzir; faça seek em três pontos diferentes.
- Repita com MOV, MKV ou MXF. O Chromium não implementa todos os codecs/
  contêineres que o FFmpeg decodifica; **não** confundir falha da prévia
  com falha do arquivo para playout.
- Quando a prévia não rodar, confira a mensagem sobre codec/arquivo
  ausente. Clique em **Preparar prévia MP4 compatível**. Aguarde o FFmpeg;
  em filmes longos, leva tempo e consome disco. A cópia vai apenas
  para a pasta de dados da bancada e a mídia original permanece intacta.
- Se o arquivo estiver somente na nuvem, marque **Sempre manter neste
  dispositivo** no Explorador e aguarde a sincronização antes de importar.

## 2 — Cortes

Abra **✂ Blocos** de uma ocorrência parada. O número inicial é 3.
Escolha 1, 2 ou até 6; defina IN e OUT de cada bloco e confirme.
Os blocos podem conter intervalos não contíguos; não podem se
sobrepor ou ultrapassar a duração do arquivo. Ação
**Salvar somente edição** preserva uma única ocorrência já existente.
**Criar N blocos** a substitui pelas N ocorrências.

Teste o caso 1 bloco de 00:10 a 00:30 e o caso 2 blocos
00:10–00:30 e 01:00–01:30 em uma mídia com duração suficiente.

## 3 — Inédito / Reprise

Na timeline selecione **Exibição**: Normal, Inédito, Reprise, Estreia,
Especial ou Ao vivo. Também marque o item no OPEC/Scheduler. Salve o
roteiro, aplique no playout e feche/reabra a bancada. A identificação
deve persistir em cada ocorrência sem alterar o arquivo da biblioteca.

## 4 — Horário de entrada

Em cada item seguinte da timeline aparece **FALTA hh:mm:ss • ENTRA
hh:mm:ss**. Os horários são **estimativas**, calculadas a partir de agora
e da duração restante da fila. Não são horários rígidos configurados
para disparo. Se houver loop antes, itens posteriores exibem
**sem previsão (loop anterior)**. Teste com o primeiro vídeo já em
30 segundos de reprodução e compare a previsão do segundo.

## Limites

Os testes automáticos do GitHub cobrem build/typecheck, persistência,
ranges de vídeo, transcodificação sintética FFmpeg e stress de curta
duração. A reprodução visual real no teu Windows e a compatibilidade
do codec de teus arquivos só podem ser homologadas no ensaio local.

A bancada não transmite áudio nem vídeo NDI. O sender de produção
continua limitado a vídeo 1080p29.97 nesta versão.
