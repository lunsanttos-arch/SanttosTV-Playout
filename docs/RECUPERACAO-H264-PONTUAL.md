# Material reproduzível com ressalva

O diagnóstico de `5 - Coelho Branco.mp4` mostrou uma unidade H.264 inválida de 9 bytes: o modo estrito não produziu imagens, mas o modo padrão concluiu a leitura com código zero e 61.128 quadros contra 61.129 declarados. Isso não caracteriza uma falha generalizada do episódio nem prova sincronismo ou ausência de artefatos visuais.

A política 2 mantém a análise estrita como primeira passagem. Só tenta uma segunda leitura quando o erro contém uma unidade H.264 pequena, sem imagem (até 32 bytes). A recuperação exige simultaneamente:

- Segunda leitura terminada com código zero, progresso final e quadros produzidos.
- Contagem de quadros declarada pelo arquivo disponível e diferença entre zero e um quadro, sem excesso de quadros.
- Progresso final alcançando a duração declarada da faixa de vídeo, com margem de 250 ms.
- No máximo oito linhas de erro, sem truncamento do log, limitadas ao padrão de unidade pequena sem imagem e envio do pacote inválido. Erros de macroblocos, ocultação de corrupção e mensagens desconhecidas continuam reprovando.
- Medição de áudio e hash concluídos; arquivo estável durante toda a análise.

O resultado persiste como aprovado com `warning` e evidência `recovery`, sem apagar a ressalva. Biblioteca e roteiro mostram **Reproduzível com ressalva**. Análises antigas aprovadas permanecem válidas; reprovações da política anterior são verificadas novamente ao carregar os materiais. Durante a nova análise, a reprovação anterior continua bloqueando o material. Arquivos avulsos da programação recebem o mesmo tratamento, sem cadastro na Biblioteca.

O PROGRAM remove a parada no primeiro erro somente para esse resultado de recuperação confirmado e com assinatura do arquivo correspondente. Os demais arquivos locais continuam com o modo estrito. Se o original mudou, a tolerância não é reutilizada: o material precisa ser analisado novamente. Os mecanismos de prazo, contingência e avanço para o próximo item permanecem ativos.

Essa exceção não repara nem converte vídeos. Um material com ressalva precisa de avaliação visual e de áudio no equipamento da emissora, especialmente no primeiro quadro e nas transições. A contagem declarada pode ser inexata; um quadro a menos não é, isoladamente, prova da posição de um defeito. Reprovações de outras naturezas, fontes sem contagem confiável ou leituras interrompidas não são liberadas automaticamente.

Testes: `test-quality-recovery.js` cobre os limites do relatório fornecido e um MP4 real com primeiro pacote AUD vazio; `test-media-quality.js` mantém a reprovação por corrupção no meio do vídeo. `run-native-qa.cjs --quality-recovery-only` verifica no Electron a reprodução do material recuperado e o avanço para um sucessor que mantém os flags estritos. Esses ensaios não substituem a avaliação do episódio original no Windows.
