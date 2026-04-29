-botao "sair da conta" [tirar]


aba de novo item esta aparecendo uma barra lateralpra rola , feio esteticamente
nao consigo selecionar nenhum svg 

nao precisa ter barra de rolagem, da pra organizar sem precisar descer a tela
tudo que tiver barra de rolagem retire

quando clico m  detalhe do item tambem tem uma barra desnecesaaria

====
toda vez que eu clico em detalhe do item aparece isso no console GET https://kkjvfybghwmenxpkscbw.supabase.co/rest/v1/withdrawal_items?select=quantity%2Cwithdrawal%3Awithdrawals%28id%2Ccode%2Cstatus%2Ccreated_at%2Crequested_by_person%3Apeople%21withdrawals_requested_by_fkey%28full_name%29%29&stock_item_id=eq.dd7f3aab-250a-4d38-9e22-fc9b65275283&order=created_at.desc&limit=10 400 (Bad Request)
(anônimo) @ index-BTJ8DVWo.js:34
(anônimo) @ index-BTJ8DVWo.js:34
await in (anônimo)
(anônimo) @ index-BTJ8DVWo.js:11
then @ index-BTJ8DVWo.js:11Entenda o erro
index-BTJ8DVWo.js:34  GET https://kkjvfybghwmenxpkscbw.supabase.co/rest/v1/withdrawal_items?select=quantity%2Cwithdrawal%3Awithdrawals%28id%2Ccode%2Cstatus%2Ccreated_at%2Crequested_by_person%3Apeople%21withdrawals_requested_by_fkey%28full_name%29%29&stock_item_id=eq.dd7f3aab-250a-4d38-9e22-fc9b65275283&order=created_at.desc&limit=10 400 (Bad Request)




========
plano cuidadoso

**1. O AuthContext agora é "cego" para mudanças externas** Como você removeu o `onAuthStateChange` do `AuthContext`, a sua aplicação agora só checa o usuário **uma vez**, no momento em que a página carrega.

- **O problema:** Se o token do usuário expirar naturalmente e o cliente do Supabase renová-lo nos bastidores, o React não ficará sabendo. Pior ainda: se o usuário deslogar em _outra aba_ do navegador, a aba atual continuará achando que ele está logado até que ele dê F5 e o `initializeAuth` rode novamente.
- **Como resolver no futuro:** Voltar a usar a sua função exportada `onAuthStateChange` do `authService.ts` dentro de um `useEffect` secundário no `AuthContext`, apenas para atualizar o estado quando a sessão mudar em background.

**2. As páginas ainda "quebram" se o banco falhar** O erro sumiu porque o Supabase não está mais jogando a exceção do "Lock". Mas se amanhã o seu usuário estiver no 4G e a internet cair no meio da requisição da `StockPage`, o comando `await supabase.from('stock_items')` vai gerar um erro. E como não há um `try / catch` envolvendo isso, o `setLoading(false)` não vai ser executado e a tela de "Carregando itens..." vai ficar lá para sempre.

- **O problema:** A vulnerabilidade do F5 no código continua lá, você apenas parou de engatilhar a "arma" que disparava o problema (o erro de Lock).
- **Como resolver no futuro:** Criar o hábito de **sempre** colocar `try / catch` com um `finally { setLoading(false) }` em qualquer função assíncrona que atualize a tela.

analise esses pontos vejam se realmente fazem sentidos, nao quero pontas soltas no meu codigo. nao faz sentido um codigo robusto comm uma tipagem forte com gambiarras. priorize facilitar o codigo mas que continue forte e principalmente que funcione sem gambiarras