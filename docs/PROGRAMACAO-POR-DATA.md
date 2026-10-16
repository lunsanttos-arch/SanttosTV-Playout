# Programação por data e continuidade das grades

A data do calendário identifica a grade editorial, não limita seus materiais entre
00h e 23h59. Quando existe uma grade salva para o dia anterior, o início é calculado
pelo término dela. Esse campo fica somente para leitura no aplicativo e no navegador.
Sem uma grade anterior, a Opec define o horário inicial normalmente.

Exemplos: se a grade de 15/10 termina às 23h30, a de 16/10 começa às 23h30 de 15/10.
Se termina às 00h15 de 16/10, a próxima começa nesse instante. Os materiais podem
atravessar a meia-noite e a fila pode ultrapassar 24 horas. Cada linha mostra hora e
data; o roteiro em HTML/PDF também conserva as datas reais. Alterar o dia anterior
recalcula o início dos dias seguintes ao atualizá-los; não altera uma fila já no ar.

## Aplicação pelo master

O serviço PROGRAM valida a data, a versão salva e o início herdado, calcula o término
estimado de todos os materiais restantes da fila atual e acrescenta a nova grade.
Preserva o material no ar e a sequência ainda não exibida. Não substitui a fila restante.

A diferença aceita é de **até 180 segundos, inclusive**, para mais ou para menos.
Dentro desse limite as grades ficam em sequência, sem mudar velocidade ou cortar
materiais para esconder a diferença. O aviso informa quanto falta ou sobra e o
master compensa manualmente. Acima do limite, a operação é bloqueada sem alterar
fila ou reprodução; o aviso mostra a diferença total para alinhamento e o ajuste
mínimo necessário para entrar na tolerância.

Com o player parado, a aplicação de uma grade já iniciada localiza a ocorrência
correspondente ao horário atual, ajusta seu ponto inicial e aguarda Play. Uma grade
inteiramente passada é recusada. Uma grade futura sem fila cobrindo a espera é
recusada se a diferença exceder três minutos. Aplicar não cria um temporizador para
cortar no horário de relógio: a continuidade é sequencial, dentro da tolerância aceita.

O encaixe é recusado se o término não for previsível: pausa, LOOP, FREEZE, entrada
ao vivo manual ou duração desconhecida na fila atual. Conteúdos a definir sem
material e materiais ausentes também impedem a aplicação. Uma grade já na fila
não pode ser duplicada. Conflitos entre operadores ou alteração do início herdado
exigem atualizar a programação antes de aplicar.

O cálculo inicial usa o fuso configurado no computador master. As datas persistidas
são instantes ISO, sem depender apenas de uma hora repetida a cada dia. Os clientes
devem usar o mesmo fuso do master para visualizar os horários locais de operação.

## Verificação

- `npm run test:broadcast-schedule`: limites positivos/negativos, início às 23h30 e
  00h15, virada de ano/ano bissexto, entrada às 02h em material atravessando dias,
  persistência, propagação de edição e bloqueio por mídia ausente.
- `DISPLAY=:98 node scripts/run-native-qa.cjs --schedule-only`: Electron real com
  decoder FFmpeg e saída DEV NULL, bloqueios sem interromper o vídeo, preservação
  da fila, aplicação pelo botão e avanço automático até a próxima grade; consulta
  autenticada pelo controlador web confirma os mesmos limites absolutos.

A compatibilidade de IPC sem contexto de data continua disponível para restauração
e testes legados; o botão da operação normal sempre envia o contexto datado.
