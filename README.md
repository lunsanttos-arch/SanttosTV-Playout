# Santtos TV Automation

## Santtos TV Playout

Sistema profissional de automação de TV desenvolvido para gerenciamento de programação, reprodução de mídia e saída NDI.

---

## Versão atual

Alpha 0.2 — validação em desenvolvimento; homologação 24/7 e instalador NDI dependem de testes em Windows com SDK.

---

## Especificações

- Full HD 1920x1080
- 29.97 FPS
- 59.94 FPS
- MP4
- MOV
- H264
- Saída NDI

---

## Módulos

### Playout
Automação e reprodução da programação.

### Media Manager
Gerenciamento de arquivos de mídia.

### Ingest
Entrada e preparação de conteúdos.

### CG
Gerador de caracteres e gráficos.

### Scheduler
Programação automática.

---

## Compilar instalador Windows

Instale Node.js 22, Visual Studio Build Tools com C++ x64 e o NDI 6 SDK oficial. Na pasta do projeto, execute `npm ci` e `npm run build`. O script `scripts/build-ndi.js` recompila o engine nativo e copia a DLL autorizada para dentro do instalador. Não distribua o NDI Tools: a aplicação empacota somente o runtime conforme os termos aceitos do SDK. O instalador fica em `build/`.

NDI® é marca registrada da Vizrt NDI AB. Documentação e ferramentas oficiais: https://ndi.video/ . A redistribuição da DLL deve respeitar a licença contida na instalação do SDK; avalie a EULA do seu instalador antes de publicação.

## Tecnologia

- Electron
- React
- TypeScript
- Node.js
- SQLite
- FFmpeg
- NDI SDK
