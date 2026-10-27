# Análise de materiais, Inputs Web e publicação da playlist

## Progresso da análise

A Biblioteca e a Programação, no desktop e no navegador autenticado, mostram o arquivo atual, a etapa e seu percentual, além da fila de materiais. O percentual é **da etapa**, não uma previsão de tempo restante: vídeo, recuperação quando necessária, áudio estéreo, áudio mono e integridade SHA-256 são passagens distintas. Duração desconhecida usa indicação indeterminada.

O worker usa o progresso real do FFmpeg e os bytes lidos para SHA-256. Mensagens são limitadas a quatro por segundo, ficam em memória e não geram gravações de banco por percentual. A interface consulta um resumo pequeno, sem consultas sobrepostas; nomes da fila são limitados aos primeiros 100, mantendo o contador total. Os critérios de aprovação/reprovação continuam independentes da barra.

## Input Web na Programação

A aba Inputs Web usa os cadastros do master, suporta inclusão, busca e arrastar para incluir/substituir no roteiro. Inputs não são cadastrados como arquivos da biblioteca nem apresentados como arquivos locais assistíveis. Os modelos semanais, roteiros diários e a playlist persistem seus campos de transmissão.

O backend resolve o cadastro pelo inputId ao salvar: uma URL arbitrária enviada no lugar de um input cadastrado não substitui a configuração canônica. O roteiro guarda a configuração aprovada naquele salvamento; alterar o cadastro não muda silenciosamente uma programação já revisada. Para usar a nova configuração, salve/revise novamente a programação.

Por duração, reserva-se o tempo configurado. Por horário de saída, calcula-se o intervalo a partir da entrada programada, incluindo virada de dia e segundos; não a partir do instante em que a tela foi aberta. Na execução, o motor continua respeitando o relógio de saída do input. Links externos ainda podem vencer ou negar acesso; a presença no roteiro não garante disponibilidade futura do provedor.

## Gravação antes da ativação

A publicação da programação e o salvamento da playlist preparam uma lista normalizada sem trocar a fila usada pelo motor. O worker de persistência escreve o JSON completo em arquivo temporário, sincroniza-o e faz a substituição atômica. Somente após o ACK a fila em memória é substituída, de uma vez.

Enquanto a publicação está pendente, outra publicação, o autosave de uma fila antiga e a remoção de materiais da biblioteca não podem sobrescrevê-la. A reprodução da fila anterior continua durante a escrita. Se ela chegar ao fim nesse intervalo, após a confirmação o controlador entra na programação recém-publicada, sem reiniciar os itens anteriores. Uma parada manual continua sendo respeitada.

Se a escrita falhar, o motor mantém a fila anterior; a tentativa de recuperação da persistência reconstrói o documento a partir dessa fila, sem ressuscitar a candidata rejeitada. Materiais desconhecidos são recusados antes da gravação, em vez de desaparecer silenciosamente da nova lista. A confirmação de aplicação refere-se à playlist gravada, não à saúde dos logs e das saídas de transmissão.

Isso não é uma transação distribuída, não replica para outra máquina e não torna todas as operações do banco transacionais. Em uma interrupção entre a substituição do arquivo e a confirmação ao operador, o reinício pode encontrar a nova lista completa. Não há promessa de proteção contra defeito físico do armazenamento; os backups e o comportamento de energia/disco continuam relevantes. No Windows, o arquivo é sincronizado; a sincronização explícita do diretório, disponível no caminho Unix, não é usada.

## Verificações

- `test-media-quality.js`: progresso emitido pelo worker real nas fases de vídeo, áudio e hash, sem alterar a aprovação.
- `test-safe-timeline-publication.js`: atraso do ACK, concorrência, falha real de escrita, preservação da fila, recuperação, reinício e limpeza explícita.
- `test-publication-handoff.js`: handler real de aplicação, EOF durante o ACK, parada manual e falha de disco sem ativação.
- `test-rundown-web-inputs.js`: duração, saída por relógio após a meia-noite, headers, configuração canônica e persistência diária/semanal/playlist.
- `test-scheduling-controller.js`: autenticação dos novos endpoints.
- Integração Electron/navegador: controles reais, progresso renderizado, inclusão/drag de Input Web, salvamento e desfazer; programação e reprodução nativas continuam verificadas pelos testes existentes.
