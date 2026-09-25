# Homologação dos horários de entrada — Santtos TV Automation

Esta rodada corrige o cálculo do campo **FALTA ... • ENTRA EST. ...**
no playout. É uma previsão operacional baseada no relógio do Windows,
na **última amostra válida do tempo do vídeo em reprodução** e na duração
real de cada ocorrência da timeline. Não é um comando que agenda o disparo
do vídeo. A hora programada do roteiro OPEC é outro campo e permanece
configurável separadamente.

## Alterações de segurança operacional

- A hora estimada não pode avançar sozinha enquanto o vídeo está pausado.
  Durante pausa, antes de PLAY, durante buffer/seek ou sem sender NDI em
  produção, o sistema mostra **SEM PREVISÃO/AGUARDANDO**.
- O cálculo é ancorado no último evento real `timeupdate`; entre
  amostras, a hora absoluta se mantém, enquanto a contagem regressiva
  continua descendo com o relógio. Se o cursor não mudar por 4 segundos,
  a previsão é suspensa em vez de inventar um horário.
- **IN/OUT** de filmes editados são descontados corretamente. Ao trocar
  a ordem, avançar vídeo, buscar outro trecho ou retomar PLAY, os horários
  são recalculados a partir da situação real.
- Um **loop** recebe a previsão de sua primeira entrada se houver
  duração nos itens anteriores, mas bloqueia a previsão de todos os
  conteúdos depois dele. Loops já exibidos não bloqueiam o futuro.
- Um arquivo **sem duração analisada** bloqueia os horários posteriores:
  nunca o substituímos por um fictício `00:00:00`.
- Entradas após a meia-noite mostram `(+1 dia)` e as subsequentes
  continuam com o deslocamento de dias correto.
- O relógio do cabeçalho e a timeline agora usam a mesma projeção.
  OPEC exibe **Início programado**, distinguindo-o do
  **Entra estimado** da reprodução real.

## Teste no teu CMD (apenas bancada, não a máquina do ar)

Com qualquer operação pendente do Git finalizada e alterações locais
preservadas, na pasta do projeto:

```cmd
git status
git pull --ff-only origin main
npm ci
npm run test:timeline-forecast
npm run dev:test
```

Se `git status` mostrar arquivos teus modificados, não executar o
`git pull` até revisar as mudanças. Se o OneDrive bloquear
`.git/objects`, feche o app e pause a sincronização; nunca apague
`.git`.

### Sequência de aceitação na interface

1. Importe dois vídeos **analisados e inteiramente baixados**. Coloque
   60 segundos do primeiro e 30 do segundo na timeline. Antes de PLAY,
   verifique que **não aparece um horário absoluto inventado**.
2. Dê PLAY. Se o primeiro tiver 60 segundos restantes, a hora da
   segunda entrada deve ser próxima do relógio atual + 1 minuto.
   Aguarde 10 segundos; a hora prevista deve permanecer praticamente
   estável, enquanto **FALTA** diminui em 10 segundos.
3. Pause por 10 segundos: deve aparecer **SEM PREVISÃO**. Retome: a
   nova entrada deve ser calculada a partir da hora atual, cerca de
   10 segundos depois da estimativa anterior.
4. Faça seek para 10 segundos antes do OUT: o próximo vídeo deve
   passar a entrar em aproximadamente 10 segundos. Mude a ordem dos
   vídeos seguintes: a previsão é recalculada conforme a nova duração
   acumulada.
5. Coloque uma mídia em loop antes da terceira: a terceira deve
   apresentar **SEM PREVISÃO — LOOP ANTERIOR**.
6. Experimente uma mídia ainda sem metadados de duração: o item
   seguinte deve apresentar **SEM PREVISÃO**, não o mesmo horário da
   anterior.
7. Confira se o quadro **PRÓXIMO** mostra a mesma previsão que o
   item correspondente da timeline, e se o cabeçalho concorda com
   o final previsto do último item.
8. No OPEC, defina **23:59** como início e adicione blocos que passam
   de meia-noite; os itens do dia seguinte devem ter `(+1 dia)`.
   Não confunda esse horário programado com a previsão operacional.

As rotinas automáticas executam testes determinísticos para todos
esses casos, inclusive relógio saltando entre eventos `timeupdate`.

**Limites:** o intervalo real entre arquivos também inclui o tempo
de carregar/reinicializar o player e o FFmpeg. O campo continua sendo
**uma estimativa**, não uma garantia de corte no segundo exato. Antes
de usar em TV ao vivo, validar em receiver NDI real numa máquina de
bancada: `npm run dev:test` desativa intencionalmente o sender.
