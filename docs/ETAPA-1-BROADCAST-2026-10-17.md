# Primeira etapa de robustez — 17/10/2026

Esta implementação parte dos problemas reproduzidos no [estudo broadcast](ESTUDO-BROADCAST-2026-10-16.md).

## Confirmação da aplicação

O aplicativo exige `ok: true` e `persisted: true` antes de confirmar a aplicação. O serviço somente devolve `persisted: true` depois do reconhecimento da gravação durável. Se a fila já mudou em memória e a gravação falhar, a resposta informa `ok: false`, `applied: true`, `persisted: false`, com erro explícito. Não há rollback automático nem publicação imutável nesta etapa: o operador precisa saber que a fila em memória pode ter sido aplicada apesar da falha no disco.

## Análise completa dos materiais

Uma fila em worker separado executa um FFmpeg por vez, com baixa prioridade quando o sistema permite, um thread de decodificação e filas limitadas. Decodifica todo o vídeo principal e todas as faixas de áudio, exige quadros válidos, interrompe erros de decodificação e calcula SHA-256. Uma assinatura de tamanho, data de alteração e inode invalida a aprovação quando o arquivo muda. Essa assinatura não substitui a verificação criptográfica contínua contra alterações maliciosas.

A Biblioteca mostra aprovação, reprovação ou análise pendente, com nova verificação para falhas. A interface web acompanha a análise. A aplicação de programação por data exige aprovação dos arquivos; entradas ao vivo são excluídas dessa análise de arquivo. O uso do cache já validado continua disponível quando a origem aprovada está desconectada. Não foi acrescentada nesta etapa uma verificação criptográfica da cópia em cache.

A recuperação e a reprodução manual de acervos antigos não ficam paralisadas esperando uma primeira análise. Um arquivo reprovado que permaneça com a mesma assinatura não pode abrir um novo decoder, inclusive enquanto uma nova análise estiver pendente. A inspeção rápida anterior continua existindo para cadastrar os metadados; ela não equivale à aprovação completa. A análise em segundo plano ainda consome disco e CPU e deve ser dimensionada no hardware de produção.

## Isolamento das saídas

O pipe de vídeo NDI passa por uma fila própria, limitada por tempo e bytes. Um consumidor parado deixa de bloquear o FramePacer do PROGRAM. Ao exceder a fila ou o prazo de consumo, apenas o sender NDI é reconectado. O orçamento de PCM acompanha as amostras dos quadros aceitos pelo pipe, incluindo taxas fracionárias, e áudio e vídeo da rota são limpos juntos no reinício.

OMT mantém uma única imagem pendente e agora reconecta a própria rota quando não consome vídeo por 750 ms ou excede o limite de PCM. Diagnósticos incluem filas, descartes, falhas, intervalos de entrega e ocupação de áudio. A aceitação de bytes por um pipe **não comprova apresentação ou sincronismo no receptor**. Não foi alterado o contrato nativo de timestamps OMT e não há alegação de homologação física no Windows.

## Verificação reproduzível

- `npm run test:broadcast-stage1`: retorno real do callback da interface, arquivo bom e corrompido no meio, reprovação, substituição do arquivo, hash, fila única e invalidação da aprovação; subprocesso real que não lê stdin, fila limitada e PROGRAM contínuo.
- `npm run test:omt`: cadência, consumidor lento, prazo excedido, fila de áudio cheia e recuperação local.
- `npm test`: regressão completa de backend, interface, relógio/PCM, relatórios, programação, persistência, cache, SRT e RTMP em loopback.
- `DISPLAY=:98 node scripts/run-native-qa.cjs`: integração Electron/FFmpeg em perfil temporário, com NDI DEV NULL; não mede recepção NDI/OMT física. Inclui falha real no diretório do banco e confirmação da aplicação antes/depois de restaurar o disco.

Na integração foi encontrado e corrigido um caso específico do DEV NULL: o destino simulado deve consumir o orçamento de áudio, sem aguardar um pipe PCM inexistente. Esse modo permanece explicitamente identificado como simulação nos diagnósticos.

Resultado em 17/10/2026: os comandos acima passaram em Linux, incluindo a sequência completa Electron após essa correção. Foram verificados avanço Opec com o player parado e no ar, falha de disco, recuperação do serviço, contingência de arquivos corrompidos, retomada de posição/PAUSE/FRZ após reinício, configuração das saídas durante reprodução, SRT sem NDI e encaixe por data com tolerância de três minutos. O coletor executou apenas um smoke de cinco segundos; não foi um ensaio prolongado.

Antes de liberar para operação contínua, ainda são necessários ensaio prolongado no Windows com vMix, saídas simultâneas, 1080p60, medição de sincronismo no receptor, queda de rede e reinício do PC. A primeira etapa não substitui o burn-in de 24/72 horas descrito no estudo.
