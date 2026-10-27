# Interrupção, avanço e acesso à origem

O relatório enviado pelo operador contém duas evidências distintas:

- Às 02:14, dois materiais registraram falha do FFmpeg na alocação de memória, com `Failed to allocate packet of size 3110400` e `Cannot allocate memory`. Isso confirma falha de alocação nesses eventos, mas não identifica por si só qual processo ou limite de memória a provocou.
- O registro do Walkabout, aberto às 14:04:02 e recuperado às 14:04:27, tem `playedSecondsUnknown` e motivo de recuperação após encerramento/reinício. Ele não prova que o arquivo foi pulado ou que seu sucessor entrou no ar. O tempo parcial e o fim real da exibição não foram confirmados.

## Correções

Recuperação de registro aberto passa a usar `INTERROMPIDO`, mantendo duração desconhecida e saída não confirmada. O instante da recuperação é guardado separadamente. Registros legados que tenham exatamente os marcadores de recuperação são reclassificados ao carregar, sem alterar os erros reais de conteúdo nem apagar o histórico. HTML, XLSX e XML incluem o novo estado; o XML explicita se a saída é conhecida.

O preparo do próximo deck passa a ter prazo total de 20 segundos, incluindo resolução de origem, acesso ao arquivo e preroll. Antes, o prazo de 12 segundos do decoder só existia depois que o processo FFmpeg era criado; uma operação de rede pendente antes desse ponto podia deixar o controlador esperando indefinidamente. A unidade T: foi identificada pelo operador como unidade de rede.

O cancelamento rejeita a espera imediatamente. Um decoder que termine de preparar depois do cancelamento é descartado e não pode assumir o PROGRAM. A falha especulativa de preparo ainda permite uma tentativa nova no CUT; a tentativa de CUT também tem prazo, evitando repetição infinita. Isso limita a espera do software; não promete cancelar uma operação SMB dentro do Windows.

O diagnóstico JSON passa a incluir etapa e tempo do preparo, ocorrência do controlador, indicação de abertura, corte pendente, memória do processo e memória física total/livre do sistema. Memória física livre não mede sozinha o limite de commit/paginação do Windows nem a memória privada de todos os processos.

## Validação e limites

Testes de origem que nunca responde, chegada tardia de decoder, cancelamento, repetição limitada e avanço para sucessor; relatórios com recuperação atual e migração legada; exportação HTML/XLSX/XML; testes de controlador e decoder reais. Integração Electron com serviço PROGRAM suspenso e substituído pelo supervisor confirmou retomada do checkpoint e registro `INTERROMPIDO`.

Essas correções tratam falhas demonstradas no código. O relatório HTML não confirma a causa do travamento atual do Walkabout nem demonstra vazamento de memória. Para isso é necessário o `Santtos-diagnostico.json` capturado durante o travamento, incluindo o estado das saídas e do decoder. Não foi reduzida a qualidade de vídeo nem alterado o relógio de sincronismo para tentar compensar uma causa ainda não medida.
