# Plano de Ação - Melhorias Visuais e Funcionais

## 1. Plano de Melhoria Visual (Conceitual)
*As modificações descritas nesta seção são apenas um planejamento de design (conforme solicitado, nenhum código visual será modificado agora).*

- **Refinamento do Dark Mode (Glassmorphism):** Introduzir texturas sutis e fundos borrados (`backdrop-blur`) nos modais, dropdowns e barras de navegação para trazer um visual "translúcido" e menos pesado.
- **Tipografia Premium:** Padronizar o uso de fontes como *Inter*, *Roboto* ou *Outfit* em vez da fonte padrão do sistema, aumentando a legibilidade.
- **Micro-interações:**
  - Adicionar efeitos de "hover" mais dinâmicos nos botões e linhas de tabela (mudança de escala leve, brilho nas bordas).
  - Transições suaves (`transition-all duration-300`) ao mudar entre os passos do formulário de Nova Retirada.
- **Animações de Feedback:** Substituir carregamentos (spinners) por animações mais personalizadas e criar toasts de sucesso/erro que entram na tela de forma fluida.

---s

## 2. Plano de Correções Funcionais (Para implementação Imediata)

### A. Remover Atraso da Confirmação do Telegram
- **Problema:** A UI de "Nova Retirada" trava (loading) esperando que a notificação do Telegram termine de ser enviada devido ao uso do `await notifyTelegram()`. 
- **Solução:** Remover o `await` da chamada e englobar em um bloco não-bloqueante (`fire-and-forget`). Assim, o usuário verá o sucesso imediatamente e o envio para o Telegram continuará acontecendo em segundo plano de forma silenciosa.
- **Arquivo Alvo:** `app/src/pages/withdrawals/NewWithdrawalPage.tsx`

### B. Funcionalidade "Arraste e Solte" (Drag and Drop) para Arquivos
- **Problema:** O usuário tem que clicar ativamente para selecionar uma foto ou PDF nos campos de "Registro fotográfico" ou "Documento com assinaturas".
- **Solução:** 
  - Transformar as áreas dos `inputs` em "Dropzones".
  - Implementar manipuladores de eventos: `onDragOver`, `onDragEnter`, `onDragLeave` e `onDrop`.
  - Prover feedback visual quando um arquivo estiver sendo arrastado sobre a área.
  - Reutilizar a lógica existente do `onChange` para processar o arquivo dropado (seja PDF ou Imagem).
- **Arquivo Alvo:** `app/src/pages/withdrawals/NewWithdrawalPage.tsx`
