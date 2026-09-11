# QA Interceptor

Extensão Chrome/Edge (Manifest V3) para forçar respostas HTTP durante testes de validação: status code, corpo, cabeçalhos, latência e falha de conexão — sem mexer no backend nem no código do app.

## Instalar

1. `chrome://extensions`
2. Ligue **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecione esta pasta
4. Fixe o ícone na barra

## Usar

1. Abra o popup e ligue a chave no topo (o badge mostra `ON`)
2. **Nova regra**:
   - **URL contém**: `/api/atividades` (trecho da URL), ou com curinga `*` (`/api/*/anexos`), ou marque regex
   - **Método**: `ANY` ou um verbo específico
   - **Comportamento**:
     - `Responder direto` — devolve o status e o corpo que você definir, sem chamar a API
     - `Falhar a conexão` — o `fetch` rejeita com `TypeError: Failed to fetch` / XHR dispara `error`
     - `Só atrasar` — deixa a chamada real acontecer, mas com o delay aplicado
   - **Atalhos**: preenchem status + texto (400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504, 204)
3. Recarregue a página em teste
4. A aba **Interceptados** mostra o que foi capturado na sessão

As regras são avaliadas de cima para baixo; a primeira que casar vence.

## Exemplos

| Cenário | URL contém | Comportamento |
|---|---|---|
| Tela de erro ao salvar | `/atividades` + `POST` | `500` |
| Validação do formulário | `/atividades` + `POST` | `422` com `{"errors":{"titulo":["obrigatório"]}}` |
| Sessão expirada | `/api/` | `401` |
| Spinner / timeout | `/atividades` | `Só atrasar`, 8000 ms |
| Offline parcial | `/upload` | `Falhar a conexão` |
| Lista vazia | `/atividades` + `GET` | `200` com `[]` |

## Como funciona

Um content script roda no contexto da página (`world: "MAIN"`) em `document_start` e substitui `window.fetch` e `XMLHttpRequest.prototype`. Um segundo content script, isolado, sincroniza as regras de `chrome.storage` para a página e envia os logs ao service worker.

Por rodar no nível de `fetch`/XHR, funciona com axios, React Query, SWR, Apollo e afins.

## Limitações

- Só afeta `fetch` e XHR feitos pela página. Não pega navegação, `<img>`, `<script>`, `<iframe>`, EventSource, WebSocket, nem requisições disparadas de dentro de um service worker do app.
- O DevTools mostra a chamada real como inexistente nos casos de mock — o que você vê é o que a aplicação recebeu.
- Regras chegam via mensagem assíncrona: uma requisição disparada nos primeiros milissegundos do `document_start` pode escapar. Na prática isso raramente acontece, mas se acontecer, recarregue.
- `world: "MAIN"` exige Chrome/Edge 111+.

Se precisar interceptar no nível real de rede (incluindo navegação e recursos estáticos), o caminho é a permissão `debugger` com `Fetch.enable` / `Fetch.fulfillRequest` do CDP — mais fiel, porém exibe a faixa de "navegador sendo depurado" e não pode rodar junto com o DevTools aberto.

## Reduzir o escopo

O manifest usa `<all_urls>`. Para restringir aos seus ambientes, troque nos dois `content_scripts` e em `host_permissions`:

```json
"matches": ["http://localhost/*", "https://*.seudominio.com.br/*"]
```
