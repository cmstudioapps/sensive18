# Sensive18

Um wrapper open-source extremamente simples, rápido e direto ao ponto para **detecção de conteúdo adulto (NSFW)**, nudez, gore, e **estimativa de idade facial** em imagens e vídeos utilizando inteligência artificial diretamente no Node.js (via `@tensorflow/tfjs-node`).

O Sensive18 esconde toda a complexidade do machine learning (como gerenciamento de tensores 3D, limpeza de memória e carregamento de modelos) e expõe apenas uma API limpa.

> Todas as funções possuem **aliases em inglês** (`analyzeImage`, `analyzeVideo`, `estimateAge`) para facilitar times internacionais.

---

## 📦 Instalação

```bash
npm install sensive18
```

---

## ⚙️ Configuração

A biblioteca utiliza configurações globais para ditar a rigidez da moderação de NSFW.

```javascript
const moderador = require('sensive18');

// Configura o rigor do bloqueio (threshold).
// Varia de 0.0 (bloqueia qualquer coisa suspeita) a 1.0 (muito liberal).
// O padrão é 0.8.
moderador.config({ threshold: 0.8 });
```

---

## 📷 Moderação de Imagem (NSFW)

Analisa uma imagem para descobrir se ela contém conteúdo explícito, pornográfico ou sensível. Aceita inteligentemente o caminho de um arquivo (`String`), um `Buffer` nativo do Node.js, ou uma string em `Base64`.

### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function validarUpload(req) {
    try {
        // Pode ser um arquivo local...
        const analise = await moderador.analisarImagem('./uploads/foto.jpg');
        
        // Pode ser um Buffer do multer...
        // const analise = await moderador.analyzeImage(req.file.buffer);

        // Pode ser Base64 vindo do front-end...
        // const analise = await moderador.analyzeImage('data:image/jpeg;base64,...');

        if (!analise.isSafe) {
            console.log(`Foto bloqueada! Nível de nudez: ${analise.explicitScore}`);
        } else {
            console.log(`Foto limpa e segura.`);
        }
    } catch (err) {
        console.error('Erro na análise', err);
    }
}
```

### O que essa função retorna?
O retorno é sempre uma `Promise` que resolve para um objeto JSON exato:

```json
{
  "isSafe": false,
  "explicitScore": 0.9542,
  "topCategory": "Porn",
  "rawPredictions": [
    { "className": "Porn", "probability": 0.9542 },
    { "className": "Hentai", "probability": 0.0003 },
    { "className": "Sexy", "probability": 0.0231 },
    { "className": "Neutral", "probability": 0.0101 },
    { "className": "Drawing", "probability": 0.0123 }
  ]
}
```
- **`isSafe` (Boolean):** Seu melhor amigo. Já cruza os dados com o `threshold` que você configurou e te diz "sim ou não" direto ao ponto.
- **`explicitScore` (Number):** A soma das probabilidades das categorias pesadas (`Porn` + `Hentai`). De 0.0 a 1.0.
- **`topCategory` (String):** A classe principal detectada. Pode ser `Porn`, `Hentai`, `Sexy`, `Neutral` ou `Drawing`.
- **`rawPredictions` (Array):** Os dados matemáticos puros vindos diretamente da rede neural caso queira fazer um cruzamento complexo.

---

## 🎬 Moderação de Vídeo (NSFW)

Analisa um arquivo de vídeo de forma silenciosa extraindo e escaneando "keyframes" usando o ffmpeg embutido.

### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function checarVideo() {
    // Opções: { frames: X }. Define quantas partes do vídeo checar (ex: 3 extrai no início, meio e fim).
    // O input para vídeos DEVE ser obrigatoriamente um caminho local (String).
    const analise = await moderador.analisarVideo('./video_usuario.mp4', { frames: 3 });
    // Alias: moderador.analyzeVideo()

    if (!analise.isSafe) {
        console.log(`Bloqueado! Encontrada categoria pesada: ${analise.topCategory}`);
    }
}
```

### O que essa função retorna?
```json
{
  "isSafe": false,
  "explicitScore": 0.8710,
  "topCategory": "Hentai",
  "rawPredictions": [ ... ],
  "details": "Análise baseada no frame mais explícito extraído."
}
```
*Atenção: A função devolve o JSON exatamente no mesmo padrão de imagens para unificar sua lógica de backend. Os scores retornados correspondem ao pior frame (o frame mais "sujo") encontrado durante o escaneamento do vídeo.*

---

### 3. Estimativa de Idade e Rosto (Face API)

Localiza um ou mais rostos na foto e detecta matematicamente a provável idade e o gênero. Útil para processos de verificação de conta (KYC) e proteção para menores.

#### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function kyc(fotoDocumento) {
    // Aceita File Path, Buffer ou Base64
    // Novo: Você pode passar a opção `underAgeCheck` com a idade alvo.
    const rosto = await moderador.estimarIdade(fotoDocumento, { underAgeCheck: 18 });
    // Alias: moderador.estimateAge()

    if (!rosto.hasFaces) {
        return "Foto recusada: Nenhum rosto humano detectado na imagem.";
    }

    console.log(`Detectados ${rosto.faceCount} rosto(s).`);
    
    // Varrendo os rostos e imprimindo detalhes matemáticos
    rosto.faces.forEach((face, index) => {
        console.log(`Pessoa ${index + 1}: ${face.age} anos, gênero ${face.gender}`);
        if (face.isUnderAge) {
            console.log(`Certeza de ser menor de idade: ${(face.underAgeProbability * 100).toFixed(1)}%`);
        }
    });
}
```

#### O que essa função retorna?
```json
{
  "hasFaces": true,
  "faceCount": 1,
  "faces": [
    { 
      "age": 14, 
      "gender": "female", 
      "genderScore": 0.985, 
      "box": [120, 250, 60, 60],
      "isUnderAge": true,
      "underAgeProbability": 0.9608
    }
  ]
}
```
- **`isUnderAge` (Boolean):** Flag opcional presente se você informar o `underAgeCheck`.
- **`underAgeProbability` (Number):** Uma curva de probabilidade sigmoide (logística) exata variando de 0 a 1 que calcula a distância entre a idade real detectada e o seu limite de verificação. Ex: Se a IA detectar alguém com 12 anos e seu limite é 18, a probabilidade da pessoa de fato ser uma criança será de 99,1%. Se a IA detectar alguém de 17 anos (muito próximo a 18), a probabilidade cai para ~70%. Isso evita falsos positivos drásticos!

---

### 4. Estimativa de Idade em Vídeos (Face API para Vídeos)

Da mesma forma que o moderador de NSFW para vídeos, você pode mandar a biblioteca escanear o vídeo inteiro em busca de rostos. A inteligência artificial embarcada consegue, usando uma avançada função matemática de "Cosine Similarity", identificar e agrupar rostos idênticos entre os frames extraídos! Isso significa que ela retorna **quantas pessoas diferentes** apareceram durante o vídeo inteiro, ignorando clones de uma mesma pessoa em diferentes cenas.

#### Exemplo de Código
```javascript
const moderador = require('sensive18');

async function validarIdentidadesNoVideo() {
    // Opções: { frames: X }. Define a quantidade de frames a serem escaneados.
    const analise = await moderador.estimarIdadeVideo('./apresentacao.mp4', { frames: 5 });
    // Alias: moderador.estimateAgeVideo()

    if (analise.hasFaces) {
        console.log(`Detectamos ${analise.uniquePeopleCount} pessoas diferentes no vídeo!`);
        console.log(`Detalhe das idades de todas as faces rastreadas no vídeo:`, analise.faces);
    }
}
```

#### O que essa função retorna?
```json
{
  "hasFaces": true,
  "faceCountTotal": 8,
  "uniquePeopleCount": 2,
  "faces": [
    { "age": 25, "gender": "male", "genderScore": 0.985, "box": [120, 250, 60, 60] },
    { "age": 28, "gender": "female", "genderScore": 0.92, "box": [400, 100, 50, 50] },
    ...
  ]
}
```
- **`faceCountTotal` (Number):** A soma total de todos os rostos identificados varrendo todos os frames (pode conter pessoas repetidas).
- **`uniquePeopleCount` (Number):** A contagem mágica de identidades **únicas** no vídeo, obtida comparando as assinaturas faciais neurais de cada rosto.

---

## 🧠 Arquitetura e Vantagens Técnicas

1. **Anti Memory-Leaks (Vazamento de Memória):** Diferente de implementações ingênuas de IA no Node.js, a biblioteca limpa religiosamente os tensores decodificados do C++ (`imageTensor.dispose()`) após cada processamento, garantindo que o seu servidor não trave mesmo validando milhares de fotos por dia.
2. **Offline Local Models:** As redes neurais são baixadas localmente junto com o `npm install`. Em nenhum momento a Sensive18 envia fotos dos seus usuários para fora ou precisa de conexão externa para ler os pesos da rede. Funciona 100% offline em redes seguras corporativas.
3. **FFMPEG Inteligente e Estático:** A análise de vídeos não falha caso o servidor do usuário não tenha ffmpeg instalado no Ubuntu/Windows. A Sensive18 embala seu próprio executável (`ffmpeg-static`), o que garante compatibilidade.

## ⚖️ Licença
Sensive18 é livre e open-source licenciado através da **MIT License**.
