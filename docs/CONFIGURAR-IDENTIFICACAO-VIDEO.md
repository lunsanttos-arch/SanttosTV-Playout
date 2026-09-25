# Configuração da identificação editorial no PROGRAM

Na aba **Configurações → Identificação no vídeo** agora é possível ajustar
o selo **Inédito / Reprise / Estreia / Especial / Ao vivo** sem editar código.
A opção **Normal** continua sem texto de identificação.

O painel reúne:
- Exibir/ocultar, textos personalizados (por tipo), fonte, tamanho,
  negrito, cor e opacidade;
- Alinhamento à direita do logo, distância acima dele e deslocamentos
  horizontal/vertical;
- Contorno com cor, largura e transparência;
- Sombra opcional com cor, opacidade e deslocamentos;
- Tarja de fundo **desativada por padrão**, com opção de cor, opacidade
  e margem interna quando habilitada;
- Prévia de 16:9 com o logo real configurado (ou indicação provisória
  caso não haja arquivo de logo).

Os valores são validados no processo principal do Electron antes de
serem salvos em `userData/database/santtos-tv.json` (específico para cada
instalação, separado na bancada). Posição e rótulos são utilizados no
filtro FFmpeg do PROGRAM e reproduzidos na prévia React.
Os textos de cada tipo aceitam até 32 letras, números, espaço, ponto,
barra, hífen e sublinhado.

## Teste na tua pasta existente (CMD)

Com o aplicativo fechado, Git sem operações pendentes e OneDrive
pausado caso esteja bloqueando arquivos do projeto:

```cmd
git pull --ff-only origin main
npm ci
npm test
npm run dev:test
```

Na bancada:

1. Entre em **Configurações → Identificação no vídeo**.
   O padrão deve ter texto branco, contorno discreto e **sem tarja**.
2. Selecione **Reprise** como exemplo. Edite tamanho, cor e distância
   acima do logo. Verifique a prévia em tempo real.
3. Troque o texto de Reprise para **OUTRA EXIBIÇÃO**, ligue a sombra,
   e salve. Depois altere a marcação de um clipe na timeline para Reprise
   e confira a nova inscrição na prévia sobre o vídeo.
4. Volte às configurações, ative a tarja opcional com outra cor,
   salve e reteste. Desative a tarja ao terminar.
5. Feche o aplicativo, abra de novo com `npm run dev:test`,
   e confira se fonte, texto, cor, posição e fundo foram preservados.
6. Execute `npm run test:exhibition-output`: o script gera quadros
   Full HD com FFmpeg e valida as identificações e o fundo opcional.

**Atenção para operação de TV:** A bancada `dev:test` não envia NDI.
A configuração já salva é usada pela saída FFmpeg/NDI ao começar o
**próximo clipe** ou reiniciar a reprodução atual. Não reiniciamos
automaticamente um vídeo ao vivo ao salvar o visual para evitar cortes
no ar. A verificação final do NDI exige sender e receiver reais fora
da máquina de transmissão em operação.

As configurações não ativam áudio NDI nem SRT, que ainda são etapas
separadas.
