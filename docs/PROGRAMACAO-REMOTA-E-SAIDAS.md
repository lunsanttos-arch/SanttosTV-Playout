# Programação remota e saídas do PROGRAM

Na aba **Programação**, ative **Programação remota**. No outro computador da mesma rede, abra o endereço exibido pelo master, por exemplo `http://IP-DO-MASTER:8787/controller`, e informe o código de acesso mostrado no master. A porta TCP 8787 deve estar permitida no firewall do Windows para a rede local. Desativar o acesso encerra as sessões; reativar gera outro código.

O navegador e o software usam as mesmas abas de pastas da biblioteca cadastradas no master e salvam a programação por dia. Arraste uma mídia para a lista para adicionar ao final, sobre um item para inserir antes dele, ou sobre um espaço “Conteúdo a definir” para substituí-lo. Arraste os cartões da programação para reordenar; a área ao final da lista permite mover um cartão para o fim. Pode adicionar **Conteúdo a definir**, com nome e duração prevista. No master, clique em **Atualizar programação**, substitua os espaços pelos conteúdos definitivos e clique em **Aplicar no Playout**. Espaços vazios impedem a aplicação. Uma programação modificada por outro operador exige atualização antes de salvar, para evitar sobrescrever seu trabalho. A aplicação é exclusiva do master; o acesso remoto não controla a saída no ar.

Compile a interface com `npm run build:renderer` depois de atualizar o código. Isso também gera a página do controlador remoto. O acesso remoto é ativado pelo operador em cada abertura do programa.

## Input Web e ritmo dos quadros

HTTP/HLS, SRT e RTMP/RTMPS podem ser cadastrados como Input. RTMP exige uma URL de reprodução fornecida pelo servidor, que pode ser diferente da URL de publicação usada pelo encoder.

A preparação de um Input ao vivo começa até 15 segundos antes da troca. O tuner valida vídeo/áudio decodificáveis e reserva pelo menos dois segmentos HLS completos. Um buffer de quadros, limitado em memória, suaviza rajadas antes de enviar o PROGRAM no FPS configurado. PCM e monitor de vídeo acompanham os quadros entregues. Isso acrescenta uma pequena latência; pausas de rede maiores que a reserva ainda podem interromper o sinal. Uma fonte gravada mantém reprodução desde o início.

## NDI, OMT, SRT e RTMP

NDI e OMT ficam na mesma seção, compartilham o nome da fonte e usam o perfil de vídeo/áudio do sistema. OMT usa sempre qualidade alta. O estado conciso de cada saída aparece no topo; o indicador Motor Santtos fica roxo durante reprodução e cinza quando parado.

SRT e RTMP são saídas reais do PROGRAM, com vídeo H.264 e áudio AAC. A conexão é preservada nas trocas de conteúdo quando o perfil e o destino continuam iguais. Configure o destino e ative a saída desejada. Resolução, FPS, taxa de amostragem e canais vêm do sistema; bitrate, GOP e preset são definidos automaticamente. SRT mantém modo, IP, porta, latência e credenciais opcionais. RTMP recebe a URL completa, incluindo o caminho/chave exigido pelo servidor. SRT não é enviado automaticamente para um destino fictício.

## Cache e relatórios

A aba **Cache** ajusta somente o limite de armazenamento. No Windows, arquivos em outros discos e caminhos UNC usam cache automaticamente; arquivos no C: continuam locais. A biblioteca é preparada em segundo plano enquanto o motor está parado, e os materiais atuais/próximos recebem preparação operacional. Ao atingir o limite, as cópias mais antigas são removidas, preservando arquivos em uso ou transferência. Os originais não são apagados.

Relatórios diários são gerados em HTML para leitura/impressão e XLSX para Excel, preservando o XML anterior. A aba Relatórios oferece abertura da pasta e de cada relatório. Se o Excel mantiver o XLSX aberto, uma versão `_Atualizado.xlsx` recebe a atualização.

FREEZE na barra do player ativa o congelamento ao final do item selecionado, usando o mesmo ajuste da Timeline.

## Validação desta alteração

A suíte automatizada cobre programação remota/autenticação/conflitos, placeholders, relatórios legíveis, cache/evicção, buffer de quadros e recepção SRT/RTMP com áudio e vídeo. O teste ao vivo de 20 segundos entregou 500 quadros, com intervalo máximo de 46 ms após o buffer a 25 FPS. No Electron, um Input ao vivo de 15 segundos em 1080p29.97 entregou 450 quadros de monitor, encerrou corretamente e não registrou erro no motor.

Os testes de desenvolvimento foram feitos em Linux. Recepção NDI/OMT e firewall devem ser conferidos no Windows com os receptores usados na operação; a bancada Linux não valida esses emissores nativos.
