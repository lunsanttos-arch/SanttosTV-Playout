# Diagnosticar um vídeo sem compartilhá-lo

Em janela de manutenção, com o Santtos fechado, abra o Prompt na pasta do projeto atualizado e execute:

```bat
git pull origin main
npm run diagnostico:video -- "D:\Series\5 - Coelho Branco.mp4"
```

Substitua o caminho pelo arquivo real, mantendo as aspas. Também pode digitar `npm run diagnostico:video -- ` e arrastar o arquivo do Explorador para o Prompt para inserir seu caminho. Não é necessário iniciar o Santtos. Esse comando requer Node e as dependências do checkout já instaladas, como no ambiente atual de desenvolvimento; não é uma ferramenta autônoma do instalador.

Espere aparecer **Relatório criado**. São duas leituras completas possíveis e isso pode levar vários minutos por episódio. O comando usa os mesmos resolvers de FFmpeg/FFprobe do aplicativo, informa a versão e não altera vídeo, banco ou aprovação do material. Nenhum arquivo é enviado pela ferramenta.

O resultado fica em `diagnosticos\diagnostico-video-XXXXXXXX.json`. Esse JSON pode ser enviado para análise sem o episódio. Ele contém nome/tamanho/data do arquivo, características técnicas e uma amostra limitada das mensagens de decodificação, com o caminho de origem removido. Confira seu conteúdo antes de compartilhar; ele ainda identifica o nome do episódio.

A primeira passagem replica a política de parar no primeiro erro (`-xerror -err_detect explode`); a segunda usa o tratamento padrão do decoder, sem essas opções. Ambas decodificam a primeira faixa de vídeo não anexada e todas as faixas de áudio, sem gerar outro vídeo. Elas registram código de saída, quadros produzidos, progresso final e mensagens. A passagem padrão pode encerrar com erro e não garante correção visual ou sincronismo, mesmo com código zero.

`nearLastProgressSeconds` é somente o último progresso recebido antes da mensagem, não o horário exato do pacote defeituoso. O número de mensagens não equivale ao número de quadros afetados. Não use o resultado para liberar automaticamente um arquivo reprovado. Se o arquivo mudar durante a leitura, o relatório registra essa condição e a comparação precisa ser repetida com uma origem estável.
