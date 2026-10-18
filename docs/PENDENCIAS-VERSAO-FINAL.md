# Pendências para liberação profissional

Atualizado em 18/10/2026 (America/Sao_Paulo). Escopo comercial atual: Lite com saídas por rede; saída física fica para uma futura Pro. O [estudo broadcast](ESTUDO-BROADCAST-2026-10-16.md) contém as referências e os critérios detalhados.

## Antes de colocar a versão final no ar continuamente

1. **Homologação Windows/vMix:** validar NDI, OMT, SRT e RTMP, isolados e simultâneos, no hardware da emissora em 1080p59,94/60. Medir áudio/vídeo no receptor, canais L/R, picos, loudness e continuidade durante cortes, logos, entradas ao vivo, trabalho da Opec, análise de materiais e reprodução da Biblioteca. OMT ainda exige comprovação física do contrato de apresentação; testes do pipe não provam o receptor.
2. **Ensaio de 24/72 horas e recuperação:** acompanhar quadros, memória, filas e relatórios; interromper rede, receptor e fonte ao vivo; simular arquivo indisponível/corrompido e falta de espaço; testar reinício do Windows e restauração do backup. O smoke automatizado curto não cobre operação prolongada.
3. **Troca dos materiais de um dia para o outro:** por decisão do responsável, não implementar avisos de substituição. Teste do cache confirma que uma troca no mesmo caminho (inclusive mesmo tamanho, com data de modificação diferente) faz a próxima resolução usar o original novo e posteriormente renovar o cache. Se a origem estiver indisponível, permanece o fallback da última cópia. Isso não atualiza automaticamente duração/IN/OUT de grades existentes, não troca um decoder já aberto e não detecta uma alteração que preserve tamanho e data. A checagem de assinatura na aplicação invalida QC. Não tratar a substituição no disco como edição automática dos cortes.
4. **Publicação da grade e falha de disco:** a interface já diferencia aplicação em memória de gravação durável. Evoluir para snapshot publicado/versionado e recuperação inequívoca quando houver falha entre essas etapas; permitir revisão controlada dos itens futuros sem alterar o item no ar. Não anunciar transação atômica enquanto a fila puder mudar em memória antes da confirmação da gravação.
5. **Instalador de produção e rollback:** preparação implementada em `npm run build:lite`, com NSIS x64, preservação dos dados, sem execução automática ao finalizar, kit versionado, hashes e inventário dos componentes essenciais. Instruções em [Instalação Lite](INSTALACAO-LITE.md). Ainda gerar o candidato no Windows com SDK NDI/runtimes aprovados, revisar licenças/assinatura e testar instalação limpa, atualização e rollback com cópia do perfil correspondente. O kit não equivale a um instalador homologado.
6. **Perfis de imagem e áudio homologados:** conferir barras/rampas, full/limited, BT.601/709, conversões de entrelaçamento e tratamento de HDR. O nivelador atual tem perfil inicial de −23 LUFS e proteção de pico; antes de vender conformidade, comparar com medidor independente e com as exigências da emissora, incluindo o sinal recebido após compressão.

Se o controlador sair da rede local confiável, preparar HTTPS/VPN e permissões/auditoria por operador antes de expô-lo à internet.

## Depois da implantação inicial, conforme solicitado

Preparar a [operação em duas máquinas](PLANO-OPERACAO-DUPLICADA.md): papéis dos equipamentos, replicação de grades e versões dos materiais, acompanhamento de posição e procedimento de comutação/retorno. Essa redundância futura não foi implementada nem homologada.

As funções de assistir pela Biblioteca e nivelar áudio estão descritas em [Reprodução da Biblioteca e nivelamento](BIBLIOTECA-E-NIVELAMENTO-2026-10-17.md). A construção funcional está avançada, mas liberação profissional exige fechar as pendências e anexar evidência da bancada real.
