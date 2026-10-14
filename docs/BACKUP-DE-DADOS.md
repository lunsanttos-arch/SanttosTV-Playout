# Backup de dados

Em **Configurações → Backup**, o Santtos guarda programação, cadastros da biblioteca, Inputs, configurações, histórico de exibição e posição de recuperação. Os vídeos, cache, miniaturas em arquivos separados e arquivos de logo não são copiados. Caminhos cadastrados permanecem no backup; em outro PC, ajuste as pastas e materiais.

A rotina vem ligada, com uma cópia por hora e retenção das últimas 30 versões. A primeira verificação ocorre 30 segundos após abrir o programa. Frequência e quantidade podem ser ajustadas; as cópias ficam em `userData/data-backups`. **Criar backup agora** e **Exportar backup** funcionam independentemente da rotina automática.

A pasta adicional é opcional, sem assinatura de nuvem. O aplicativo cria nela a subpasta **SanTTos Playout Backups**. Cada instalação limpa somente seus próprios backups automáticos; exportações manuais e arquivos de outras instalações são preservados. Se a pasta adicional falhar, a cópia local continua válida e o painel informa a falha. A cópia externa é tentada na próxima execução; o aplicativo não monitora serviços de sincronização de terceiros.

Os backups usam a extensão `.santtos-backup`, formato versionado comprimido e SHA-256 por arquivo. A restauração rejeita nomes fora da lista de dados, duplicatas, versão incompatível, JSON inválido e alteração do conteúdo. O limite descomprimido é 128 MB. Isso verifica integridade, não criptografa nem autentica a autoria do backup; ele pode incluir senhas e configurações de transporte. Guarde em pasta protegida.

Para restaurar, pare o PROGRAM, selecione o arquivo, confira data/versão/cadastros e clique **Restaurar e reiniciar**. A aplicação valida novamente, prepara a restauração e reinicia. Os dados entram antes de carregar o banco; a posição é recuperada com a reprodução parada. Um journal permite recuperar o estado anterior se a aplicação for interrompida durante a troca. A pasta `data-restore-rollback` preserva os dados anteriores até a próxima restauração. Os relatórios HTML/XLSX são reconstituídos a partir do histórico; os vídeos não são recuperados por essa função.

As cópias, compressão e validação executam em worker separado do processo principal do PROGRAM. A rotina não representa backup contínuo: mudanças feitas depois da última cópia podem faltar. O backup local não protege contra perda do disco; configure a pasta adicional em armazenamento independente para essa proteção.

Validação: `npm run test:data-backup` verifica retenção, exclusão de vídeo/cache, falha da pasta adicional, estrutura/checksum, aplicação interrompida, recuperação parada e worker.
