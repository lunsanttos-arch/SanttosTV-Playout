# Bloqueio entre PCM e vídeo no motor

O diagnóstico enviado mostrou `Sem novos quadros do material por 8 segundos.` e um sucessor já em PLAYING. Isso aponta para a contingência do motor; o relatório antigo não preservava o estado do item que falhou. Esse motivo não prova corrupção do arquivo nem identifica sozinho a origem da falta de quadros.

Na revisão foi reproduzido um ciclo de espera no controle de PCM: ao atingir o limite de um segundo, a entrada de áudio era pausada e somente retomava abaixo de meio segundo. A liberação depende dos quadros de vídeo entregues. Se a reserva curta de vídeo acaba antes de consumir esse meio segundo, e o FFmpeg precisa drenar o pipe PCM antes de gerar novos quadros, ambos ficam esperando.

O controle agora retoma a leitura assim que há espaço abaixo do limite, mantendo o teto de memória e a liberação de áudio baseada na quantidade exata de quadros. Não há alteração de velocidade, descarte/duplicação de amostras ou aumento do prazo da contingência. O teste de regressão enche a fila, disponibiliza um único quadro a 59,94 fps e exige que o produtor seja liberado antes de depender de novos quadros. Ele falhou com a condição anterior e passou com a mudança.

O diagnóstico passa a guardar `lastFailure` antes do avanço: estado do item que falhou, PID/filas do decoder, idade do último quadro, pausas dos pipes, origem resolvida, mensagens recentes do FFmpeg, perfil e métricas. Mantém também o estado do item atual. Dados são redigidos pelo filtro de diagnóstico existente; o registro da última falha fica em memória até encerrar o processo. O relatório de exibição continua sendo o registro persistente do item pulado.

A reprodução no Windows precisa ser confirmada. Uma interrupção real do armazenamento/rede ou saturação de processamento também pode causar ausência de quadros; a correção desse ciclo não elimina essas outras causas.
