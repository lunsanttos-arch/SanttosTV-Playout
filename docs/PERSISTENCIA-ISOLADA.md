# Persistência fora da thread de reprodução

Implementação de 15/10/2026, correspondente ao item de isolamento de gravações
da revisão de arquitetura. O formato JSON existente foi mantido. Não é
necessário converter o banco nem reimportar vídeos ao atualizar.

## O que mudou

```text
Interface desktop / OPEC web
              |
     validação + estado em memória
              |
        alterações incrementais
              v
Workers de persistência -- serialização JSON / escrita / fsync / backup / rename
              |
         confirmação durável
              v
      resposta de salvamento

PROGRAM continua entregando vídeo e áudio enquanto o worker aguarda o disco.
```

`src/core/persistence/json-store.js` gerencia workers Node em threads separadas,
com uma instância por documento. `json-writer-worker.js` executa as operações
de disco. São threads dentro do processo do aplicativo, não um novo servidor
para instalar. Esta mudança não é a extração completa do PROGRAM para outro
processo, nem a implementação dos decks A/B.

Cobertura: banco principal, categorias da biblioteca, Inputs Web, configurações
de operação/cache, índice do cache, histórico/configuração de relatórios e
checkpoint de recuperação. A exportação HTML/XLSX/XML e o backup já usavam
workers; a filtragem/ordenação do histórico para exportação também saiu da
thread principal nesta alteração.

Banco e relatório recebem alterações incrementais: configuração específica,
dia da programação, material alterado ou ocorrência de exibição. O início,
primeiro quadro, fim e identificação do sucessor enviam apenas a ocorrência.
Importação em lote envia os materiais novos em uma operação, sem ocupar uma
posição da fila por arquivo. O histórico inteiro não é serializado na thread
que entrega os quadros.

Leitura e validação iniciais dos arquivos ainda ocorrem na abertura do programa,
antes da retomada. Cópia de estruturas pequenas para comunicação entre threads
também usa CPU da thread principal; não há promessa de tempo real rígido.

## Ordem e confirmação

- Cada documento tem revisões e no máximo uma gravação em andamento. Alterações
  pendentes da mesma chave são agrupadas, preservando a ordem das alterações
  restantes e o valor capturado quando o comando foi enviado.
- O limite é de 2.048 operações pendentes distintas por documento. Há no máximo
  duas barreiras de confirmação: lote em execução e lote pendente. Checkpoints
  rápidos substituem o valor pendente, em vez de formar uma fila ilimitada.
- O worker grava em temporário exclusivo, sincroniza o conteúdo, preserva a
  geração anterior por uma cópia temporária sincronizada e faz a troca por
  rename. Em POSIX também sincroniza a pasta; Windows não usa fsync de diretório.
- A confirmação só é enviada após o commit. Bloqueios breves de rename no Windows
  têm três novas tentativas limitadas. Uma gravação que não responde em 30 segundos
  interrompe o worker e informa falha.
- Uma queda pode deixar temporários órfãos; eles não são tratados como banco
  válido nem substituem o arquivo principal. Não se apagam arquivos de outra
  instalação para tentar recuperar uma operação.

IPC de salvamento e HTTP da OPEC aguardam a barreira antes de retornar sucesso.
Aplicar programação, editar modelos, salvar configurações e registrar operações
manuais seguem essa regra. PLAY/PAUSE/NEXT e o avanço automático não passam a
esperar disco para entregar quadros.

As funções internas do banco e do relatório continuam atualizando a memória
imediatamente, para não bloquear o motor. Para uso fora dos adaptadores IPC/HTTP,
o chamador deve aguardar `flushDatabase()`, `flushReports()` ou
`flushPersistence()` antes de anunciar durabilidade, recarregar arquivos ou
copiar um backup. `PlayoutRecovery.save`/`saveAsync` agora retornam Promise.

## Falhas, fechamento e backup

Erro de permissão, disco cheio, serialização inválida, timeout ou morte do worker
rejeitam a confirmação e preservam as alterações em memória para nova tentativa.
Não há fallback para escrita síncrona no motor. Ao tentar de novo, o worker é
reconstruído quando necessário e recebe o estado atual, incluindo mudanças que
não tiveram confirmação. A nova tentativa não duplica ocorrências por ID.

Uma falha pendente aparece como aviso no aplicativo e nos diagnósticos. Uma nova
operação de salvamento tenta recuperar o serviço antes de prosseguir. Checkpoints
posteriores também tentam recuperar seu writer sem lançar erro síncrono para
fora do callback do relógio. O erro de gravação não aciona contingência de mídia.

Ao fechar, o aplicativo aguarda checkpoint, banco e histórico pendentes. Pedidos
repetidos de fechar não contornam essa espera. Se o disco continuar indisponível,
há opção explícita de tentar novamente ou fechar sem salvar as últimas alterações.

Antes de criar/exportar backup, `DataBackupService` aguarda as confirmações
pendentes. O backup continua contendo dados operacionais e não os vídeos/cache.
Cada arquivo é uma geração completa; não há transação única entre todos os
documentos. Uma edição concorrente posterior à barreira pode pertencer à próxima
geração do backup. Não foi introduzido SQLite nem prometida transação entre arquivos.

No fechamento abrupto ou queda de energia, uma alteração sem ACK ainda pode ser
perdida. O checkpoint continua periódico; não é uma gravação a cada quadro.

## Validação

- `npm test`: regressão completa de backend, frontend, controlador, relatórios,
  cache, recuperação, áudio/vídeo, transportes e demais módulos.
- `npm run test:recovery`: inclui os testes novos de persistência e integração.
  Eles exercitam fsync lento, continuidade de timers/cadenciamento na thread
  principal, ENOSPC/EACCES, morte/timeout do writer, fila limitada, lotes de 3.000
  materiais, valores capturados, ACKs agrupados e tentativa posterior de checkpoint.
- Integração de persistência bloqueia qualquer chamada de gravação síncrona na
  thread principal durante operações normais; confere os JSONs resultantes,
  Código/Nome e horário real do relatório, backup com edição pendente e resposta
  HTTP antes/depois da confirmação e em falha.
- `npm run test:native-integration`: Electron real em perfil descartável DEV NULL;
  inclui teste de banco temporariamente indisponível, falha real de IPC, aviso na
  tela e continuidade do PROGRAM, além de retomada, pausa, FRZ, erros de mídia e SRT.

Resultados desta entrega devem ser lidos com os limites de
[HOMOLOGACAO-WINDOWS.md](HOMOLOGACAO-WINDOWS.md): a bancada Linux não certifica
NDI/OMT em receptores físicos Windows nem substitui 24/72 horas reais de operação.
