# Arquivos avulsos na Programação

No aplicativo master, arraste arquivos de vídeo do Explorador diretamente para o roteiro. Sobre o centro de uma linha, o destaque roxo indica **Substituir Item**; entre linhas, a barra indica **Incluir Item**. Vários arquivos entram na ordem fornecida pelo Explorador. Ao substituir com vários arquivos, o primeiro substitui o alvo e os demais entram logo abaixo. Desfazer reverte a operação inteira.

Esses arquivos não são adicionados à Biblioteca nem às suas pastas. O sistema mantém uma referência técnica separada, junto aos dados da programação, para preservar metadados, análise de integridade, horários, blocos, reprodução de consulta, aplicação ao Playout e retomada após reinício. Ela também permite salvar/importar o roteiro e modelos sem perder os materiais avulsos. Se necessário, o operador pode cadastrar o mesmo arquivo na Biblioteca por uma ação explícita independente.

O arquivo original precisa permanecer disponível no caminho usado. Não há cópia para a Biblioteca nem exclusão automática do original depois da exibição. A política existente de cache para caminhos externos ao disco C continua aplicável; o backup de dados conserva referências/metadados, não os vídeos. A análise completa segue obrigatória antes de aplicar uma grade datada; arquivo avulso não contorna a contingência de material corrompido.

Trocar a data ou fechar a aba durante a leitura não insere arquivos na programação que acabou de ser aberta. O drop admite até 100 arquivos por operação e não aceita pastas. No controlador pelo navegador, continua disponível o arraste da Biblioteca; arquivos locais do PC remoto não são enviados para o master por esse recurso.

Validação automatizada: `npm run test:backend` cobre persistência separada e `DISPLAY=:98 node scripts/run-native-qa.cjs --explorer-drop-only` exercita o Electron com arquivos reais via eventos nativos de drag/drop (usar um DISPLAY disponível). O workflow QA executa esse teste em perfil descartável. A homologação manual do Explorador no Windows permanece necessária.
