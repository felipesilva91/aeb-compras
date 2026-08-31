# Núcleo de Compras — Alencar & Bezerra Engenharia

App de gestão de compras da AeB: obras, pedidos de material, status de
andamento, notificações e login por usuário.

## Como rodar no VS Code

1. Abra esta pasta no VS Code (`File > Open Folder...`).
2. Abra um terminal dentro do VS Code (`Terminal > New Terminal`).
3. Instale as dependências (só precisa fazer isso uma vez):
   ```
   npm install
   ```
4. Rode o servidor de desenvolvimento:
   ```
   npm run dev
   ```
5. O terminal vai mostrar um link, algo como `http://localhost:5173`.
   Segure Ctrl (ou Cmd no Mac) e clique nele — abre no navegador.

## Como ver a versão de celular

Com o app aberto no navegador (Chrome, de preferência):

1. Aperte `F12` ou `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac) pra
   abrir as ferramentas de desenvolvedor.
2. Clique no ícone de celular/tablet no canto superior esquerdo do
   painel que abriu (ou aperte `Ctrl+Shift+M` / `Cmd+Shift+M`).
3. Escolha um aparelho na lista (iPhone, Galaxy, etc.) — a tela do
   app se ajusta automaticamente, incluindo o menu lateral que vira
   uma gaveta com ícone de hambúrguer.

Se preferir ver dentro do próprio VS Code, instale a extensão
**"Live Preview"** (da Microsoft) e use o comando
`Live Preview: Show Preview` apontando pro link do `npm run dev` —
ela abre um painel dentro do editor e também dá pra simular
tamanhos de tela.

## Login de teste

Ao abrir pela primeira vez, escolha qualquer nome da lista e entre
com a senha padrão `aeb123` — o app vai pedir pra criar uma senha
nova na hora. Isso já vem populado (Felipe, Glyffiton, André,
Gerson, Luana, Júlia, Felipe Henrique, Bruno, Jadson).

## Sobre o armazenamento dos dados

O app salva tudo de verdade no **Supabase** (banco Postgres na nuvem) —
usuários, obras, pedidos, notificações e as fotos. Todo mundo que
rodar o app com o mesmo arquivo `.env` vê os mesmos dados,
sincronizados em tempo real (a cada 20 segundos ele atualiza sozinho).

As credenciais ficam no arquivo `.env` na raiz do projeto (esse
arquivo NUNCA vai para o Git — está protegido pelo `.gitignore`):
```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx
```
Se for rodar o projeto em outro computador, copie o `.env.example`,
renomeie para `.env` e cole os valores reais do seu projeto Supabase
(Settings > API Keys > Publishable key).

Se o comando `npm run dev` mostrar um aviso "Supabase não
configurado" no console do navegador, é sinal de que o `.env` está
faltando ou com os valores errados — o app continua abrindo, mas
não vai salvar nada.

## Logo

Os arquivos da marca ficam em `public/`:
- `logo-full.png` — logo completa (usada na tela de login)
- `logo-mark.png` — só o símbolo "AB" (usado no menu lateral e no
  topo da versão mobile)
- `favicon.png` — ícone da aba do navegador

Se a AeB atualizar a identidade visual, é só substituir esses três
arquivos pelos novos (mantendo os mesmos nomes).

## Publicar o site de verdade (colocar no ar)

Quando estiver pronto pra equipe usar de verdade:
```
npm run build
```
Isso gera uma pasta `dist/` com o site pronto — é só subir essa
pasta em qualquer hospedagem (Vercel, Netlify, ou onde a AeB já
hospeda outras coisas).
