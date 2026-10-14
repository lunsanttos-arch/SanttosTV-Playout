# Operação, recuperação e contingência — 0.3.0-rc.1

## Motor e grade

O backend controla o item em exibição, o avanço, LOOP/FRZ e o relatório. O Chromium mostra o estado do motor. Se a interface encerrar inesperadamente, ela é recarregada; o backend continua a sequência. A programação aplicada preserva o item que está no ar ou pausado e substitui os próximos itens. Aplicar uma grade com o motor parado limpa a seleção antiga.

Todas as fontes usam entrega de vídeo temporizada. Quando há áudio, vídeo e PCM saem do mesmo FFmpeg; o PCM é liberado pelos quadros entregues. NDI, OMT, SRT e RTMP são consumidores do PROGRAM. Uma saída lenta não deve segurar o decoder nem as demais saídas. Sob sobrecarga do transporte, o encoder é reiniciado com áudio/vídeo juntos; não são descartados PCM e vídeo de forma independente.

Inputs têm preparo de rede e um buffer de quadros; isso não constitui dois decks A/B locais completamente decodificados. Medir o corte e o intervalo de áudio no receptor continua sendo condição de homologação. O ensaio funcional em DEV NULL valida sequência e estado, não continuidade perceptual no receptor.

## Configurações → Operação

- **Retomar o PROGRAM ao abrir**: ativo por padrão. Retoma item e posição do checkpoint. Arquivos retomam a posição; fontes ao vivo voltam ao sinal atual. Checkpoints são atômicos, têm cópia anterior e são atualizados aproximadamente a cada segundo, também nas mudanças de estado. A escrita periódica usa I/O assíncrono com fila limitada ao último checkpoint pendente.
- **Iniciar com o Windows**: opcional, disponível no aplicativo instalado. Usa início no login do usuário; não é serviço antes do login. Depois de reiniciar o PC, é necessário que o usuário inicie uma sessão Windows.
- **Reabrir após falha do aplicativo**: disponível no instalado Windows e ativo por padrão. Um supervisor externo recebe heartbeat. Encerramento inesperado ou ausência de heartbeat por 30 segundos provoca uma reabertura. Fechamento normal para o supervisor e não reabre o aplicativo. Falha simultânea do supervisor e do aplicativo não está coberta por este mecanismo.
- **Vídeo de contingência**: opcional, cadastrado na biblioteca. Sem vídeo configurado, a contingência mantém preto e silêncio. Se o filler também falhar, permanece preto; não entra em repetição de abertura do arquivo danificado.
- **Falha sem novos quadros**: padrão de 8 segundos, ajustável entre 5 e 60. Só supervisiona reprodução ativa; FRZ e pausa deliberados não são falhas. Silêncio de conteúdo não é falha por ausência de áudio.

Pausa e FRZ continuam nesses estados após reabrir. Uma grade concluída fica concluída; não é reiniciada automaticamente. Fechar com material no ar salva a posição para a próxima abertura. Queda abrupta de energia pode perder o último intervalo entre checkpoints; use UPS para o computador, discos e equipamentos de rede.

## Item com erro e relatório

Arquivo ausente, falha de abertura ou ausência prolongada de quadros provocam **PULADO POR ERRO**. A grade procura o próximo item; ao esgotar os candidatos, entra a contingência configurada. FREEZE editorial não impede a contingência de um item com erro.

HTML, XLSX e XML incluem entrada/saída, material, motivo, tempo exibido, conteúdo seguinte e contingência. A entrada efetiva de uma execução corresponde à primeira imagem; o preparo do Input não é contado como exibição. O conteúdo seguinte é atualizado quando o sucessor realmente entrega imagem. Um encerramento inesperado deixa uma ocorrência identificada como interrompida por erro no relatório; a retomada inicia outra ocorrência, sem apagar o histórico. Quando a duração parcial não puder ser recuperada após uma queda, HTML/XLSX mostram “Não recuperado” e o XML sinaliza `duracao_exibida_conhecida=false`; não se afirma que nada foi exibido.

Se uma configuração restaurada apontar para uma pasta de relatórios que não puder ser aberta/criada, o aplicativo usa a pasta padrão para permitir corrigir o destino na interface. A exportação HTML/XLSX/XML roda em worker e agrupa solicitações pendentes por data. O histórico canônico permanece em JSON, com gravação atômica. Banco da biblioteca e histórico ainda usam gravações JSON síncronas em algumas operações; a homologação deve medir disco lento, histórico grande e importação durante o ar antes de anunciar limites de escala.

## Saídas e diagnóstico

As saídas SRT/RTMP habilitadas mantêm preto/silêncio também antes do primeiro item e depois do fim da grade. SRT/RTMP reconectam durante o mesmo item, com espera crescente de 1 a 15 segundos. Encerrar o aplicativo interrompe os encoders e suas tentativas. NDI/OMT mantêm seus mecanismos de recuperação; a comprovação de recepção depende de outro computador.

O diagnóstico exportado inclui versão, perfil e estado operacional. Credenciais e URLs sensíveis são removidas da exportação. O coletor `npm run burn-in -- --hours 24` registra tempo real, quadros/PCM emitidos, memória do processo principal e estados. O coletor não mede sincronismo no receptor, memória dos processos FFmpeg ou perda na rede. Consulte o roteiro Windows para essas medidas.

## Backup

Consulte [BACKUP-DE-DADOS.md](BACKUP-DE-DADOS.md). Inclui programação, biblioteca, configurações, relatórios e checkpoint, agora também as opções de operação. Não copia vídeos nem cache. Pasta adicional é opcional. Restaurar dados exige conferir caminhos e arquivos no computador de destino; um backup de dados não substitui as mídias originais.

O controlador remoto permanece HTTP com autenticação na rede local. Acesso externo deve passar por VPN ou HTTPS administrado; não publicar a porta diretamente na Internet. Horários da programação são calculados a partir da hora inicial; não se anuncia hard start de rede.

## Dependências do candidato

Electron atualizado de 37.10.3 para 44.7.2; Vite 8.3.4, TypeScript 6.0.3 e ferramentas de build atualizadas com lockfile. A auditoria de produção retornou zero vulnerabilidades. A auditoria completa retornou oito entradas moderadas na cadeia de ferramentas de build (`sprintf-js` → `roarr`/`global-agent` → `@electron/get`/electron-builder), sem altas ou críticas. São entradas de uma cadeia de advisory; não oito falhas independentes. Não havia versão corrigida de sprintf-js indicada pela auditoria. O CI inclui Electron e ferramentas no gate de vulnerabilidades altas/críticas.

A versão continua candidata: o workflow e o código não substituem as medições e os gates Windows. A versão mínima de mídia permite montar um candidato; não significa que todos os builds ou perfis estejam homologados.


## Espaços ao vivo na Programação

A OPEC pode marcar um “Conteúdo a definir” como **Ao Vivo**. O título é opcional e os minutos reservados continuam calculando os horários seguintes. A marcação é salva também pelo controlador no navegador e permite aplicar a grade sem selecionar um arquivo para esse espaço. Lacunas comuns ainda precisam ser substituídas.

Ao chegar ao espaço ao vivo, o Santtos fica pausado, com saída preta e áudio silencioso. O master corta a transmissão para o vMix manualmente e, ao terminar, avança para o próximo item no Santtos e retorna o corte. A duração reservada é uma previsão; esse espaço não dispara avanço automático nem controle do vMix. Os blocos de um filme substituído não ocupam os espaços marcados como Ao Vivo.

O campo de minutos permite apagar e redigitar o valor, inclusive fracionado. Ao sair do campo, valores vazios ou fora do intervalo de 1 segundo a 24 horas retornam à última duração válida.
