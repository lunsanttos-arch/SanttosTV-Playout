# Santtos Playout: estudo de robustez, segurança e aceitação broadcast

Data: **16/10/2026**. Código avaliado: **`34228cba3f3e8373b43c7b423b3c2f6eead1e546`**.

Implementação posterior: [primeira etapa de robustez, escopo e testes de 17/10/2026](ETAPA-1-BROADCAST-2026-10-17.md). As evidências abaixo descrevem a revisão original.

## Parecer para decisão

**Recomendo manter a arquitetura atual e fechar falhas de confirmação, controle de qualidade de mídia, isolamento das saídas e homologação física antes de anunciar operação profissional contínua.** Não encontrei fundamento para uma reescrita geral. Encontrei melhorias verificáveis e dois comportamentos reproduzidos que merecem correção.

O mercado inicial considerado é o que estamos construindo: **master Windows, programação Opec remota, arquivos locais/cache, entradas ao vivo e entrega para vMix por NDI/OMT, além de SRT/RTMP**. Uma solução para esse mercado pode ser profissional sem implementar imediatamente toda a infraestrutura de uma central SMPTE ST 2110. A declaração comercial precisa corresponder à matriz efetivamente homologada.

O principal investimento agora deve comprar três coisas: **prevenir material defeituoso antes do ar; impedir que uma saída defeituosa comprometa as demais; provar no receptor que imagem e som continuam corretos**. Recursos adicionais de interface não substituem essas entregas.

### O que este estudo comprova

- Consultou fontes primárias: recomendações EBU, ITU, documentação NDI/OMT/SRT/FFmpeg/Electron, produtos comerciais, projetos abertos e relatos públicos com discussão dos mantenedores.
- Confrontou essas fontes com o código atual, documentos de homologação, workflow de distribuição e testes existentes. Auditorias anteriores são históricas: não tratei como ausentes os decks A/B, o serviço PROGRAM e a persistência que já implementamos.
- Executou duas reproduções isoladas sobre o código atual, sem abrir a grade do usuário: confirmação de aplicação com backend simulado em erro; validação de um arquivo gerado e danificado depois dos primeiros quadros.
- Consultou novamente os advisories npm. Produção: **0 vulnerabilidades reportadas**. Árvore completa: **8 entradas moderadas, 0 altas e 0 críticas**, nesta consulta. As oito entradas decorrem de uma cadeia de dependências com advisory em `sprintf-js`; não são oito falhas independentes.
- Não executou um novo ensaio físico Windows, vMix/NDI/OMT em dois PCs, medição elétrica de lipsync, teste de invasão ou ensaio contínuo de 72 horas. Documentação de fabricante não equivale a teste independente; issue aberta não equivale a causa confirmada nem prova de falha nas versões atuais.

As referências selecionadas estão no final e possuem URL, natureza e data de consulta no [registro de fontes](evidence/BROADCAST-FONTES-2026-10-16.json). As [reproduções](evidence/BROADCAST-PROBES-2026-10-16.json) e o [script executável](../scripts/research/broadcast-probes.cjs) tornam os dois achados revisáveis.

## 1. O que já está bem encaminhado

| Capacidade atual | Por que importa | Limite da evidência |
|---|---|---|
| PROGRAM em `utilityProcess`, separado da janela | A interface não precisa continuar respondendo para a grade avançar | Falha do serviço, do Windows ou do PC ainda pode interromper o canal |
| Dois decks, preroll, cancelamento por revisão e ativação do decoder preparado | Reduz o custo e a incerteza do corte | Um deck pronto no software não comprova corte sem falha no receptor Windows |
| Vídeo e PCM do mesmo decoder; liberação de áudio vinculada aos quadros | Evita duas conexões de fonte com relógios diferentes | Senders, buffers e receptores ainda podem introduzir diferença |
| Relógio monotônico e FPS racional | Protege a duração de ajustes do relógio civil e de arredondamentos | Relógio civil da grade e relógios dos equipamentos continuam exigindo testes próprios |
| Preview e monitor de áudio limitados; JPEG sempre drenado | A janela lenta não acumula indefinidamente nem deve bloquear PROGRAM | Monitor saudável também não prova saída recebida saudável |
| Contingência, supervisão e registro de erro/sucessor | A falha de um material não precisa encerrar a lista | Recuperação tem tempo finito; não equivale a redundância sem interrupção |
| Persistência em workers, confirmação durável, backups e retomada | Reduz I/O no caminho crítico e perda de estado | Publicação precisa manter coerência entre memória, disco, fila e mensagem ao master |
| Grade com data completa, continuidade entre dias e tolerância de ±180 s | Evita confundir duas ocorrências das 21h em dias diferentes | Não implementa entrada rígida de rede nem revisão segura de uma grade já aplicada |
| Electron com sandbox, isolamento de contexto e IPC restrito; Opec com autenticação e conflito de edição | Já existe uma base de proteção | HTTP/PIN compartilhado não oferece identidade individual nem confidencialidade de transporte |
| CI abrangente, verificação de runtime e roteiro Windows | Existe uma base reproduzível para liberação | Não encontrei laudo versionado de instalador e receptores aprovados em 24/72 h |

Referências internas: [serviço/A-B](SERVICO-PROGRAM-E-DECKS-AB.md), [persistência](PERSISTENCIA-ISOLADA.md), [grade por data](PROGRAMACAO-POR-DATA.md), [homologação Windows](HOMOLOGACAO-WINDOWS.md), [CI](../.github/workflows/qa.yml).

## 2. O que os outros sistemas ensinam

| Sistema / fonte | Prática útil para nós | Como interpretar |
|---|---|---|
| **CasparCG** [S19] | Servidor de mídia separado do cliente de controle; saídas e consumidores com comportamento próprio | Referência de desenho, não motivo para copiar suas dependências ou trocar nosso motor |
| **ffplayout** [S15–S16] | Filler para falta de material/grade, início de dia configurável, validação, alertas e recuperação de ingest | É próximo do uso 24/7; políticas de completar/cortar a grade são diferentes da nossa tolerância de 3 min |
| **Sofie** [S17, S29] | Separação entre lógica de programação e execução/dispositivos; necessidade de reconciliar estado depois de reconectar | É automação de produção, não um equivalente exato de playout linear |
| **Liquidsoap** [S18] | Composição de fontes com fallback capaz de continuar produzindo quando uma fonte falha | A documentação é especialmente voltada a fontes/áudio; uso como princípio de continuidade |
| **Cinegy Air / Playout** [S20–S22] | Controle e reprodução separados; requisitos de máquina e versão documentados | Documentação do fabricante; não prova desempenho superior ao nosso |
| **Pebble** [S23] | Redundância em níveis distintos, gestão de usuários e registro das atividades | Mostra critérios de compra e operação, não uma receita para adicionar um cluster agora |
| **PlayBox AirBox Neo** [S24] | Loudness e redundância 1:1/N:M tratados como funções do produto | A brochura descreve capacidades; não medi sua implementação |

**A conclusão arquitetural é conservar React/Electron para operação, o serviço autoritativo e os emissores nativos.** Melhorias nativas no agendamento e no envio podem ser feitas em um componente delimitado quando as medidas demonstrarem necessidade. Rust, C++ ou trocar o banco não garantem continuidade por si mesmos; os relatos a seguir aparecem em arquiteturas diferentes.

## 3. Insatisfações públicas que viram testes de aceitação

A amostra foi intencional, voltada às nossas falhas, não uma pesquisa estatística de satisfação. Considerei versão, contexto, discussão e estado observado em 16/10/2026.

| Relato consultado | Evidência e ressalva | Teste que deve existir no Santtos |
|---|---|---|
| **ffplayout #986** [S25] | Autor relata vídeo sem áudio por 3h12 após reancoragem de live. Comentários posteriores relatam melhora com RC e discutem memória/timeout; não é correto afirmar que a versão atual continua com o mesmo defeito | Retorno de HLS/RTMP deve recuperar áudio e vídeo juntos; verificar som realmente recebido e crescimento de memória durante vários dias |
| **CasparCG #1369** [S28] | Relato de RTMP cujo som para e volta muito atrasado; inclui rastros de timestamps. Issue antiga, de ambiente específico | Segmentos ausentes, saltos de PTS, perda da faixa de áudio e reconexão não podem reintroduzir PCM antigo |
| **DistroAV #1386** [S30] | Ordem de início OBS/câmera e sincronização de rede; discussão técnica identifica problemas de interpretação de timestamps | Iniciar receptor antes/depois do Santtos, religar fonte, reiniciar relógio e repetir a medição A/V |
| **DistroAV #1502** [S31] | Relato recente de stutter com métricas do receptor; issue encerrada em 13/10/2026. O estado encerrado, sozinho, não informa causa universal ou correção aplicável a nós | Medir captura/recepção, FPS, jitter e amostras de áudio no destino, mesmo quando o sender anuncia ONLINE |
| **Sofie #1124** [S29] | Reconexão do gateway provoca execução acelerada de eventos antigos; autor distingue observação de consequências não verificadas | Depois de queda/reinício, reconciliar o ponto válido da grade; não disparar centenas de cortes atrasados |
| **ffplayout #875** [S26] | Pedido de horário específico de entrada | Distinguir sequência editorial de evento com horário rígido; a regra atual do Santtos continua sendo encaixe sequencial com ±3 min |
| **ffplayout #494** [S27] | Relato sobre quantidade de arquivos acima de 1.000, encerrado | Testar biblioteca e histórico grandes durante o ar, incluindo busca, importação e publicação |
| **vMix: Choppy audio** [S33] | Autor relata gravação boa e saída externa ruim; resposta orienta conferir roteamento duplicado. Não prova defeito no emissor | Conferir a saída efetivamente usada pela emissora, não só preview/gravação, e registrar roteamento/receptor |
| **vMix: OMT Bandwith?** [S34] | Discussão explica negociação de qualidade com receptores | Homologar OMT com receptor/qualidade reais; “melhor qualidade” exige capacidade de CPU e rede comprovada |
| **libomt #3** [S35] | Segfault relatado na descoberta; mantenedor identifica no exemplo o uso de 10 entradas em vez do `count` retornado | Distinguir erro da integração de erro da biblioteca. Testar múltiplas fontes e limites da API antes de atribuir culpa ao OMT |

Esses relatos dão casos concretos de falha. Não demonstram taxa de defeitos, participação de mercado ou que o Santtos tenha o mesmo problema.

## 4. Dois achados reproduzidos no nosso código

### 4.1. Confirmação de aplicação pode informar sucesso após erro — P0

**Constatação:** em `App.tsx`, o callback de aplicação lê `result.message`, mas não valida `result.ok`. Em `program-runtime.js`, `registerTrustedHandle` pode retornar `{ok:false,error:...}` quando não consegue confirmar a persistência depois do handler. O ramo da interface pode então devolver “Programação aplicada ao Playout.”.

**Reprodução executada:** extraí o callback real e injetei um backend simulado que retorna erro de gravação ENOSPC. Ele devolveu exatamente a mensagem de sucesso. Não foi necessário encher um disco nem tocar na programação do usuário. Isso comprova o erro de interpretação da resposta; não simula toda a transação de disco/motor.

**Melhoria:** exigir sucesso explícito, distinguir aplicação em memória de confirmação durável e tornar publicação/ativação uma operação identificada por revisão. Definir o comportamento quando a fila já foi alterada e a gravação falha. A interface deve apresentar o estado real, sem confirmar algo que o serviço não confirmou.

**Aceite:** injetar falha antes, durante e depois da gravação. Nenhum caminho mostra sucesso indevido; após reinício, a revisão recuperada coincide com a revisão confirmada ou o estado pendente é explicitamente informado. Repetir a solicitação com o mesmo identificador não duplica itens.

Evidência: [callback](../src/renderer/src/App.tsx), [wrapper/handler](../src/main/program-runtime.js), [resultado da reprodução](evidence/BROADCAST-PROBES-2026-10-16.json).

### 4.2. Arquivo com dano no meio passa na checagem inicial — P0 para ingest profissional

**Constatação:** `decode-check.js` usa `-frames:v 1` e `-an`. É uma checagem rápida de abertura/decodificação, não uma inspeção do arquivo inteiro nem de sua faixa de áudio.

**Reprodução executada:** gerei um MP4 H.264 de 6 s, alterei 4.096 bytes em aproximadamente 65% do arquivo e executei a função atual. Resultado: `decodable:true`. Uma decodificação completa estrita do mesmo arquivo terminou com erro de dados inválidos. Isso não invalida a contingência que já temos; mostra que o problema chega ao ar quando poderia ser encontrado antes.

**Melhoria:** criar estados **recebido → analisando → aprovado / advertência / reprovado**. A verificação rápida continua útil para catalogar. A aprovação para exibição exige leitura completa em segundo plano, áudio incluído, checksum e validação de duração/PTS. Arquivos com advertência precisam de liberação explícita do master conforme a política.

**Aceite:** arquivo truncado, corrupção no meio, faixa de áudio danificada, duração incorreta e PTS descontínuo são identificados antes de aprovação. A análise concorre com limites de CPU/I/O e não prejudica PROGRAM. Alteração do arquivo invalida a aprovação anterior.

Evidência: [verificador atual](../src/core/media/decode-check.js), [script/resultado](evidence/BROADCAST-PROBES-2026-10-16.json). A integridade editorial, por exemplo uma cena ausente mas tecnicamente válida, ainda exige verificação humana.

## 5. Melhorias adicionais com fundamento técnico

### 5.1. Isolar falhas de NDI, OMT, SRT e RTMP — P0

**Observado:** `writeNativeProgramFrame()` retorna o estado da pipe NDI para o pacer do PROGRAM. OMT tem fila limitada e substituição do quadro pendente; SRT/RTMP reconectam separadamente. Portanto já existe isolamento parcial, mas NDI ocupa uma posição especial no controle de fluxo.

**Risco por inspeção:** se o sender NDI continuar vivo e deixar de consumir, o bloqueio pode atrasar a origem compartilhada, enquanto as outras saídas dependem dela. O supervisor pode descrever ausência de novos quadros como falha do material. Há supervisor de stall; não afirmei que o bloqueio seja infinito ou que o defeito já tenha sido medido no Windows.

**Melhoria:** cada saída precisa de prazo de consumo, fila limitada, estado de saúde e recuperação próprios. Uma saída secundária lenta deve recuperar sua própria sessão sem bloquear as demais. Definir qual relógio governa o PROGRAM e qual política se aplica quando o destino não acompanha. Não basta retirar o backpressure e deixar buffers crescerem.

**Aceite:** suspender apenas cada sender, reconectar receptor, saturar apenas uma rota e verificar as restantes. Arquivo válido não recebe PULADO POR ERRO por uma falha exclusivamente de saída. Memória continua limitada e áudio/vídeo de cada rota voltam juntos.

Código: [runtime](../src/main/program-runtime.js), [pipe NDI](../src/core/ndi/video-pipe-writer.js), [fila OMT](../src/core/omt/omt-output.js), [transportes](../src/core/playout/transport-output.js).

### 5.2. Contrato de apresentação comum até os emissores, sobretudo OMT — P0 de investigação/homologação

**Observado:** a origem já vincula PCM a quadros. Entretanto, áudio e vídeo OMT recebem `Timestamp = -1` no sender, e as chamadas de ambos compartilham um mutex. O header oficial OMT informa que `-1` solicita geração de timestamps e throttling pela biblioteca [S10]. Há também temporização anterior no nosso pacer e descarte de vídeo pendente sob pressão.

**Hipótese a medir:** reconstrução de tempo em estágios distintos, contenção e descarte podem contribuir para irregularidade ou diferença A/V na saída. Isso é particularmente relevante ao relato do usuário de OMT irregular com NDI normal. **Não é uma causa comprovada daquele vídeo.** O uso de `-1` é permitido pela API; não é defeito isoladamente.

**Melhoria:** especificar por quadro/bloco de áudio: geração, sequência, instante de apresentação e amostras correspondentes. Preservar a relação temporal em filas, cortes e reconexões. No NDI, distinguir `timecode` de `timestamp`; a documentação recomenda síntese do timestamp pelo SDK [S7–S8]. Não substituir cegamente essa recomendação por um relógio próprio.

Medir separadamente o tempo esperando o mutex e o tempo dentro da chamada de envio de áudio/vídeo. Conferir a garantia de thread safety da versão da biblioteca antes de alterar a serialização.

**Aceite:** medir NDI e OMT no vMix, em 1080p60 e 1080p59,94, alternando Preview/PGM, com cada saída isolada e todas juntas. Registrar intervalos e A/V por horas, após cortes/reconexões. Descartar quadros de uma rota não comprime artificialmente a linha de tempo nem deixa PCM antigo acumulado.

### 5.3. Monitorar o sinal recebido e detectar falhas parciais — P0

Hoje há contadores do motor, ausência de quadros, estado dos emissores e diagnósticos. Isso não detecta necessariamente conteúdo congelado com quadros repetidos, silêncio com PCM de zeros ou falha depois do emissor.

Implementar monitor de confiança independente, inicialmente em bancada e depois opcional no receptor. Detectar: sequência de quadros, congelamento, preto, silêncio, clipping, presença de canais e drift A/V. FFmpeg já fornece componentes como `freezedetect`, `blackdetect`, `silencedetect` e medidores [S12]; eles não substituem uma política editorial.

**Aceite:** uma imagem estática intencional, silêncio autorizado ou FRZ manual não gera corte automático. Congelamento indesejado e perda de áudio geram alarme contextualizado; ação automática só ocorre na política aprovada. O monitor identifica qual saída falhou e continua observando quando o emissor reinicia. O player continua simples; detalhes ficam no diagnóstico.

### 5.4. Tornar mídia aprovada imutável e proteger o cache do próximo deck — P1

O cache já copia para temporário, verifica tamanho/mtime e usa rename. Já protege o material ativo e transferências em andamento. A seleção de evicção não apresenta um conjunto explícito de referências para deck B e horizonte da fila: há um único `activeSourcePath`. A validação de cópia não é um checksum de conteúdo.

**Melhoria:** checksum no ingest/cópia e identidade de versão; referência protegida para material no ar, deck preparado e próximos itens necessários. Planejar espaço antes de aceitar a fila. Reprovar/recachear uma cópia alterada em vez de continuar usando uma aprovação antiga. Fazer o trabalho pesado fora do caminho de transmissão.

**Aceite:** cache no limite, origem SMB desligada, tentativa de limpeza durante A/B e atualização de arquivo com mesmo tamanho. O material no ar e o próximo pronto permanecem utilizáveis; a aplicação informa quando a cobertura offline é insuficiente.

**Não exige backup externo dos vídeos.** Mantém a decisão atual: originais sob responsabilidade da emissora, cache de reprodução e backup dos dados/configurações. Código: [ServerMediaManager](../src/core/media/server-media.js).

### 5.5. Loudness, true peak e canais de áudio — P1, antes de vender conformidade de áudio

O medidor de nível atual não comprova loudness integrado. Não encontrei pipeline de aprovação com LUFS/LKFS, LRA e true peak.

**Melhoria:** medir a mídia inteira no ingest, armazenar resultado e versão do perfil; aplicar ganho de conformação previamente calculado e proteção de pico quando apropriado. Para ao vivo, política própria com latência conhecida. Identificar L/R e permitir mapeamento explícito de faixas/canais conforme o contrato.

A EBU R128-2023 estabelece alvo de **−23 LUFS** e, para produção linear, máximo **−1 dBTP**; detalhes/tolerâncias e distribuição com compressão exigem o documento completo [S2]. Não é correto impor esse perfil a todos os clientes. Há cadeias baseadas em ATSC e exigências específicas de emissoras. O material histórico da SET confirma a relevância no Brasil, mas não substitui a norma ou contrato brasileiro vigente [S36].

**Aceite:** comparação com medidor de referência BS.1770 [S3], tons L/R, programa/comercial com níveis diferentes, áudio mono, faixas múltiplas e arquivo sem áudio. A normalização não introduz clipping nem recalcula um ganho imprevisível em cada entrada.

### 5.6. Cor, faixa de níveis e entrelaçamento — P1 por perfil comercializado

O ffprobe coleta informações de cor. O grafo principal faz geometria, FPS e formato de pixel; o OMT declara BT.709. Isso não comprova uma política completa para BT.601/709/2020, full/limited, HDR/SDR, ordem de campos e conversão de fontes entrelaçadas.

**Melhoria:** homologar inicialmente uma cadeia SDR definida, com regras de conversão e sinalização. Identificar e tratar corretamente conteúdo fora dela. Conteúdo HDR não aprovado deve ser convertido por política validada ou recusado com aviso claro. Conferir também sinalização no encoder de saída; alterar metadados sem converter os pixels não resolve.

**Aceite:** barras e rampa de níveis, SD BT.601 para HD BT.709, full/limited, 50i/59,94i para progressivo, movimento horizontal e arquivo 10-bit. Medir no receptor, não só no canvas. Resultado sem preto lavado/esmagado, branco cortado ou campos invertidos. Referência de ferramentas: [S12].

### 5.7. Publicação de grade versionada e revisão durante o ar — P1

Manter a tolerância aprovada de **±3 min**, o início herdado e a compensação manual. Ela é uma política operacional válida. Acrescentar **rascunho → validado → publicado → ativo**, identificador de publicação e trilha do operador.

Hoje o início dos dias é derivado da cadeia de grades anteriores; uma data já presente na fila é bloqueada na reaplicação. Isso evita duplicação, mas a evolução profissional precisa permitir corrigir os itens futuros sem exigir remover uma grade em operação.

**Melhoria:** snapshot publicado com ocorrência estável, data/fuso do master, revisão dos materiais e instante esperado. Mostrar um diff do futuro que será alterado; preservar o item no ar e o histórico. Revalidação no servidor continua sendo obrigatória. Atualizar o dia anterior deve indicar quais rascunhos futuros ficaram desatualizados, sem mover silenciosamente o que já foi publicado.

**Aceite:** dois operadores, importação semanal, grade acima de 24 h, virada de ano, reaplicação idempotente, edição do dia anterior, relógio civil adiantado/atrasado e navegador em fuso diferente. A recuperação escolhe o estado correto sem executar em rajada os eventos vencidos [S29].

Se surgir contrato com entrada rígida de rede, estudar um modo explícito de horário rígido e prioridade. Esse modo é separado da regra atual; não transformar a tolerância aceita em corte automático escondido.

### 5.8. Identidade, transporte e auditoria do controlador — P1 na LAN; P0 para oferta de acesso externo

Já há PIN aleatório, cookie HttpOnly/SameSite, expiração, limite de tentativas, verificação de origem e rotas limitadas à Opec. Porém o servidor usa **HTTP**, escuta em **0.0.0.0** e usa credencial compartilhada. Não há identidade individual/RBAC nas rotas examinadas.

**Melhoria:** operação local simples com rede/interface autorizada; acesso remoto protegido por HTTPS ou VPN administrada. PIN pode servir ao pareamento inicial. Contas individuais para Opec/master/admin, permissões no servidor, revogação e log de alteração com autor/revisão. Não dar à Opec controle de saída por consequência de adicionar usuários.

Limitar também conexões, requisições e trabalhos pesados; proteger credenciais de streams/configurações em repouso com recursos do Windows e controlar o conteúdo dos backups. Segredos não devem aparecer no pacote de suporte. O desenho precisa manter acesso a câmeras e servidores privados legítimos da emissora.

**Aceite:** sessão revogada, usuário sem permissão, CSRF, origem indevida, tentativas de login, mensagens grandes, solicitação repetida de exportação e cliente lento. Nenhum desses casos prejudica PROGRAM. Executar testes ativos só em instância de bancada autorizada. Referências: EBU R143 v3/2025, R148 e Electron [S4–S6].

### 5.9. Comprovação de exibição e histórico de operação — P1

O relatório já registra execução, erro e sucessor. `reportReady` se ancora na primeira entrega do motor, não em prova de recepção ou de seleção do sinal no PGM do vMix.

**Melhoria:** separar registro de reprodução do Santtos, publicação/ação do operador e observação do receptor. Associar ocorrência, revisão de mídia, revisão da grade, versão do software e motivo de mudança. Preservar registros confirmados e tornar alterações detectáveis conforme o contrato.

**Aceite:** queda/reinício no meio de um comercial, indisponibilidade da pasta de relatório, corte manual no vMix e relatório aberto no Excel. Não declarar que um comercial foi transmitido ao público somente porque o Santtos o reproduziu enquanto o vMix estava em outra entrada. Comprovação final de publicidade exige integrar o ponto efetivamente no ar ou gravação/monitoramento correspondente.

### 5.10. Segundo equipamento e plano de contingência operacional — P1 para o pacote 24/7

O watchdog recupera software; não resolve perda de energia, disco morto, atualização do Windows ou falha da máquina. O serviço tem heartbeat com janela de segundos e tentativa de reinício; o supervisor de mídia usa 8 s por padrão. Há interrupção possível até detectar e recuperar. Isso deve ser medido, não vendido como troca sem falha.

**Primeira entrega viável:** standby em outro PC com dados publicados e mídias disponíveis, nomes de fontes distintos e procedimento de troca no vMix. Não precisa depender de armazenamento em nuvem nem duplicar a biblioteca inteira por um serviço obrigatório. O conjunto necessário para a operação de reserva pode ser preparado conforme a instalação.

**Depois:** seleção automática por monitor externo, critérios claros de falha e retorno controlado. Em esquema ativo/reserva, definir quem pode assumir e impedir comandos conflitantes; em duas fontes permanentemente emitidas, definir qual é a efetivamente selecionada e refletir isso nos relatórios.

**Aceite:** desligar fisicamente o master; reserva acessível sem depender do processo/máquina que caiu. Medir tempo de detecção/troca, posição/grade após assumir e retorno. A presença simultânea de NDI e OMT no mesmo PC não atende esse teste.

### 5.11. Release rastreável e capacidade homologada — P0 para versão final comercial

A base já tem lockfile, CI, gate de runtimes, hashes para FFmpeg/FFprobe e roteiro de instalador. Falta apresentar evidência versionada do conjunto distribuído e dos perfis suportados no receptor.

**Melhoria:** candidato de release congelado; instalador assinado com identidade do fornecedor; verificação da assinatura no processo de liberação; hashes/versões de todos os emissores/DLLs; inventário de componentes e licenças; política de atualização e rollback com backup compatível. Documentar opções do build FFmpeg, licenças aplicáveis e redistribuição dos SDKs [S13–S14]. A licença MIT do projeto não elimina obrigações dos componentes distribuídos.

A auditoria npm não cobre todo o conteúdo de FFmpeg, SDK NDI, DLLs OMT ou drivers. O inventário e o acompanhamento das vulnerabilidades desses componentes precisam existir fora do resultado do npm audit. Um resultado sem altas/críticas não é uma avaliação de segurança completa.

Homologar primeiro **1080p59,94 e 1080p60**, que são relevantes ao cenário do usuário, explicitando qual deles foi selecionado. Publicar limites de CPU, memória, disco, rede, receptor/versão e combinações de saídas, baseados em medida. Manter a melhor qualidade solicitada dentro dessa capacidade.

NDI High Bandwidth 1080p60 tem referência oficial de **132,14 Mb/s** na tabela consultada [S9]. Isso não inclui todas as combinações, proxies e receptores da instalação. Internamente, só um fluxo bruto 1080p60 UYVY movimenta aproximadamente **248,8 MB/s**; esse número é de memória/pipe, não o bitrate NDI na rede. Várias cópias, conversão e dois decks precisam entrar no orçamento.

**Aceite:** instalar em Windows limpo sem ferramentas de desenvolvimento; executar a matriz no pacote assinado; atualizar e voltar de versão preservando o backup apropriado; anexar resultados dos receptores. `npm start` continua útil para desenvolvimento, mas não é o fluxo de entrega comercial homologado.

## 6. Bancada que produz evidência de aceitação

Os números abaixo são **metas propostas para a nossa homologação**, não resultados já alcançados nem requisitos universais de todo broadcaster. Fechar o orçamento por perfil antes do teste.

| Ensaio | Método | Aprovação proposta |
|---|---|---|
| Lipsync | Fonte flash/blip, captura do sinal recebido com ambos no mesmo relógio; repetir em cada saída e após cortes | Usar a EBU R37 como referência: por estágio, áudio no máximo 5 ms adiantado / 15 ms atrasado; o orçamento final da cadeia é distinto. A recomendação cita 40/60 ms no ponto de emissão, não uma autorização para cada equipamento consumir tudo [S1] |
| Drift de longa duração | Repetir marcas temporais ao longo de 24 h e 72 h; não apenas medir a latência inicial | Sem crescimento cumulativo de diferença A/V; cumprir o orçamento negociado no começo e no fim |
| Cortes locais A/B | 10.000 transições com deck pronto, frame ID e marcador de áudio no receptor | Meta de nenhum quadro preto/silêncio não previsto e transição dentro de um período de quadro; registrar também o caso de deck que não ficou pronto |
| 59,94 versus 60 | Fonte com contador, áudio 48 kHz e execução prolongada | Cadência e contagem de amostras coerentes com o perfil racional; sem tratar os dois valores como equivalentes |
| Rotas isoladas | Pausar um sender sem encerrar o processo, desconectar cabo/receptor e voltar | Demais rotas continuam; a rota afetada tem fila limitada e recupera A/V no mesmo ponto temporal |
| HLS/RTMP adverso | Servidor de bancada: 403/404, token expirado, segmentos ausentes, retomada com PTS novo, áudio desaparecendo | Falha identificada com motivo e política limitada; sem áudio antigo, repetição infinita de tentativas ou pular material válido por falha de saída |
| SRT | Receptor real: caller/listener, destino indisponível, perda/jitter/reordenação em rede de teste | Recuperação sem parar as demais rotas; estatísticas de perda, retransmissão e buffers guardadas [S11, S38] |
| Mídia adversa | Corrupção em início/meio/fim, VFR, faixas/níveis diferentes, preto/silêncio editorial | QC distingue defeito técnico e advertência editorial; contingência e relatório coerentes |
| Disco/cache | ENOSPC, I/O lento, SMB offline, limpeza concorrente, origem alterada | Sem confirmação falsa; estado recuperável, material protegido e nenhuma pausa causada pelo trabalho de análise/backup |
| Grade/controlador | Dois operadores, revisão no ar, 48 h, virada de data/fuso e relógio civil alterado | Publicação coerente e rastreável, item no ar preservado, tolerância de 180 s respeitada no servidor |
| PC/processos | Queda de renderer, serviço, sender, reinício do Windows e desligamento físico | Medir tempos distintos; reserva externa cobre a falha de máquina quando esse nível for contratado |
| Carga e duração | 24 h e depois 72 h reais, todos os processos/saídas; biblioteca de 10.000 itens e histórico representativo | Nenhuma interrupção espontânea sem explicação; buffers limitados; memória estabiliza após aquecimento; CPU/I/O com margem medida; nenhuma reinicialização periódica para esconder crescimento |

A taxa de quadros e o contador de chamadas no emissor não bastam. O ensaio precisa guardar versão, hash do instalador, hardware/drivers, arquivo-fonte, perfil, receptor, sequência de ações e captura/estatísticas do destino. Um máximo de gap tolerado em teste de isolamento Linux não se transforma em homologação de cadência no Windows.

As falhas induzidas e os estados editoriais intencionais devem ficar separados das falhas espontâneas. Um restart periódico que faça um vazamento parecer aceitável não aprova a versão.

## 7. Ordem de execução recomendada

| Ordem | Entrega | Resultado concreto para o operador | Dependências |
|---|---|---|---|
| **1 — P0** | Correção de confirmação + publicação coerente em falha de disco | O master sabe exatamente o que entrou e o que foi salvo | Contrato de resposta/estado do serviço e testes de falha |
| **2 — P0** | QC completo de mídia e estado de aprovação | Arquivo defeituoso deixa de chegar ao ar como se estivesse pronto | Worker limitado, identidade/versionamento do arquivo |
| **3 — P0** | Isolamento das saídas + investigação temporal OMT + monitor de confiança de bancada | Travada de uma rota não derruba as outras; causa observável | Instrumentação e receptor Windows real |
| **4 — P0 de liberação** | Pacote congelado, assinatura/inventário e matriz 1080p59,94/60 | Instalação e suporte reproduzíveis | Builds/runtimes aprovados e bancada |
| **5 — P1** | Cache protegido, loudness/canais e perfil SDR de cor/scan | Menos problemas de fonte, volume e imagem entre materiais | QC e perfis homologados |
| **6 — P1** | Revisão de grade publicada, trilha por operador, HTTPS/permissões | Opec/master trabalham com controle de alterações e acesso | Publicação versionada; HTTPS/VPN antes de acesso externo |
| **7 — P1 para 24/7** | Reserva em outro PC e plano de recuperação medido | A emissora tem como continuar se o equipamento principal morrer | Distribuição de dados/mídias e procedimento do receptor |

P0 significa bloquear a declaração comercial relacionada até corrigir/provar. P1 também vira obrigatório quando a função é exigida pelo cliente: loudness, acessibilidade, retenção de relatórios, segurança de rede ou redundância não podem ser prometidos sem a respectiva entrega.

Separar três ofertas evita prometer mais do que existe: **piloto assistido**, **perfil homologado no equipamento indicado** e **operação 24/7 com contingência operacional contratada**. A última depende de evidência prolongada e plano de máquina reserva, não apenas de mais testes unitários.

**Recursos a avaliar por contrato, depois da base acima:** legendas/acessibilidade e preservação de dados auxiliares; integração de traffic/EPG; eventos de rede com horário rígido; SCTE-35; SDI, genlock e SMPTE ST 2110/PTP/NMOS. Podem ser essenciais em determinados clientes, mas não encontrei motivo para implementá-los todos antes de estabilizar nosso cenário vMix/IP.

## 8. Fontes selecionadas

Consulta em 16/10/2026. Normas/recomendações são referências de engenharia; não representam certificação concedida ao Santtos. Páginas de produto são declarações do fornecedor. Relatos públicos estão sujeitos a atualização e não estabelecem causalidade sozinhos.

- **S1:** [EBU R37-2007 — sincronismo áudio/vídeo](https://tech.ebu.ch/docs/r/r037.pdf).
- **S2:** [EBU R128-2023 — loudness e true peak](https://tech.ebu.ch/docs/r/r128.pdf).
- **S3:** [ITU-R BS.1770 — medição de loudness e pico](https://www.itu.int/rec/R-REC-BS.1770/en).
- **S4:** [EBU R143 v3, março de 2025 — segurança para fornecedores de mídia](https://tech.ebu.ch/docs/r/r143.pdf).
- **S5:** [EBU R148-2018 — testes mínimos de segurança de equipamentos de mídia](https://tech.ebu.ch/docs/r/r148.pdf).
- **S6:** [Electron — Security](https://www.electronjs.org/docs/latest/tutorial/security).
- **S7:** [NDI SDK — Sending](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-send).
- **S8:** [NDI — Time, Timecode, and Sync](https://docs.ndi.video/all/getting-started/white-paper/time-timecode-and-sync-for-ndi.md).
- **S9:** [NDI High Bandwidth — tabela SpeedHQ2](https://docs.ndi.video/all/getting-started/white-paper/bandwidth/ndi-high-bandwidth-based-on-speedhq2-8bit-4-2-2.md).
- **S10:** [libomt.h — contrato de timestamp](https://github.com/openmediatransport/libomt/blob/master/libomt.h).
- **S11:** [SRT — estatísticas da API](https://github.com/Haivision/srt/blob/master/docs/API/statistics.md).
- **S12:** [FFmpeg — filtros de análise, áudio e vídeo](https://ffmpeg.org/ffmpeg-filters.html).
- **S13:** [FFmpeg — licenciamento e distribuição](https://ffmpeg.org/legal.html).
- **S14:** [NIST SP 800-218 — Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final).
- **S15:** [ffplayout — README da branch principal](https://github.com/ffplayout/ffplayout/blob/main/README.md).
- **S16:** [ffplayout — erros de live ingest e teste com rede adversa](https://github.com/ffplayout/ffplayout/blob/main/docs/ingest_error.md).
- **S17:** [Sofie — documentação do sistema](https://sofie-automation.github.io/sofie-core/).
- **S18:** [Liquidsoap 2.3.3 — fontes e infalibilidade](https://www.liquidsoap.info/doc-2.3.3/sources.html).
- **S19:** [CasparCG Server — projeto](https://github.com/CasparCG/server).
- **S20:** [Cinegy Air 26.2 — controle](https://open.cinegy.com/products/air/26.2/air/).
- **S21:** [Cinegy Air 26.2 — Playout](https://open.cinegy.com/products/air/26.2/playout/).
- **S22:** [Cinegy Air 26.2 — recomendações de sistema](https://open.cinegy.com/products/air/26.2/system-recommendations/).
- **S23:** [Pebble — automação e redundância](https://www.pebble.tv/solutions/automation/).
- **S24:** [PlayBox Neo — AirBox Neo-20, brochura 2022](https://playboxneo.com/sites/default/files/2022-10/AirBoxNeo_10_22.pdf).
- **S25:** [ffplayout #986 — ingest e retorno do áudio; relato e discussão](https://github.com/ffplayout/ffplayout/issues/986).
- **S26:** [ffplayout #875 — pedido de horário específico](https://github.com/ffplayout/ffplayout/issues/875).
- **S27:** [ffplayout #494 — biblioteca grande](https://github.com/ffplayout/ffplayout/issues/494).
- **S28:** [CasparCG #1369 — RTMP e áudio atrasado](https://github.com/CasparCG/server/issues/1369).
- **S29:** [Sofie #1124 — eventos antigos após retorno do gateway](https://github.com/Sofie-Automation/sofie-core/issues/1124).
- **S30:** [DistroAV #1386 — inicialização e timestamps](https://github.com/DistroAV/DistroAV/issues/1386).
- **S31:** [DistroAV #1502 — stutter e métricas no receptor](https://github.com/DistroAV/DistroAV/issues/1502).
- **S32:** [DistroAV #742 — evolução do atraso de áudio](https://github.com/DistroAV/DistroAV/issues/742).
- **S33:** [vMix — Choppy audio](https://forums.vmix.com/posts/t32181-Choppy-audio).
- **S34:** [vMix — OMT Bandwith?](https://forums.vmix.com/posts/t33524-OMT-Bandwith).
- **S35:** [libomt #3 — descoberta e uso do contador retornado](https://github.com/openmediatransport/libomt/issues/3).
- **S36:** [SET — Perspectivas para o controle de loudness na televisão brasileira, apresentação histórica](https://set.org.br/wp-content/uploads/2018/10/2010-Loudness-Brasil.pdf).
- **S37:** [libomt — wrapper e requisitos de build](https://github.com/openmediatransport/libomt/blob/master/README.md).
- **S38:** [SRT — criptografia](https://github.com/Haivision/srt/blob/master/docs/features/encryption.md).

O conteúdo integral de normas e páginas não foi copiado para o projeto. O registro de fontes conserva metadados e hashes dos documentos consultados. As reproduções são locais e não representam homologação completa nem teste em produção.
