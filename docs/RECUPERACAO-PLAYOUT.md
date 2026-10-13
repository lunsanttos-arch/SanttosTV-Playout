# Recuperação do PROGRAM

Ao reabrir o aplicativo, a timeline recupera o item atual e a posição salva.
Se estava reproduzindo, retoma automaticamente quando uma saída do PROGRAM
estiver pronta. Se estava pausado ou parado, permanece assim.

O checkpoint fica em `app.getPath("userData")/playout-recovery.json`, separado
do banco e com backup `.bak`. É atualizado a cada segundo, gravado com fsync
e substituição atômica. No fechamento normal, o motor nativo salva a posição
antes de encerrar. Uma interrupção abrupta pode repetir aproximadamente o último
segundo. Não apague esse arquivo para atualizar o aplicativo.

Arquivos locais retomam no timecode salvo. Fontes ao vivo voltam ao sinal atual
do servidor: um Input live não pode recuperar quadros antigos sem DVR. A recuperação
não instala inicialização automática no Windows; o aplicativo precisa ser aberto
depois do reinício do PC.

## Verificação no Windows

1. Reproduza o segundo item de uma timeline com pelo menos três itens.
2. Feche e reabra o aplicativo; confirme o item, a posição e a continuidade.
3. Pause, feche e reabra; confirme que permanece pausado na mesma posição.
4. Em uma bancada de teste, encerre abruptamente o aplicativo e reabra.

## OMT

O cabeçalho mostra `OMT DESATIVADO` enquanto a saída não estiver habilitada.
Pare o PROGRAM, abra Configurações de Saída, ative OMT e salve. Confira o estado
e a mensagem do indicador. `OMT ONLINE` indica que o sender iniciou, mas não
comprova descoberta ou recepção em outro computador. A descoberta de rede
depende do receptor, da rede local e das permissões de firewall do Windows.

Os testes Linux verificam o contrato e a recuperação de falhas de inicialização;
não executam o sender Windows nem confirmam descoberta no receptor.
