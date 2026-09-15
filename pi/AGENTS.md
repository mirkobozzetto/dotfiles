# Commandes visibles sous Herdr

S'applique a toutes les sessions pi.

Sous Herdr (ou tmux), toute commande shell passe par le tool `bash` en mode
synchrone. L'extension `pane-run` reecrit la commande pour l'executer dans un
tab visible du terminal, reutilise un tab de commande libre du meme espace, et
en cree un nouveau sans prendre le focus quand tous sont occupes. Elle ne
divise jamais un pane pour une commande d'agent.

Ne pas contourner ce routage: pas de `bg_run` ni de lancement en arriere-plan
pour une commande ordinaire, cela cache la commande et supprime son historique
visible. Pour une commande longue, augmenter le `timeout` du tool `bash` plutot
que de la passer en arriere-plan. `bg_run` reste legitime pour un serveur de
dev, un watcher ou une suite de tests longue, c'est-a-dire du travail qui doit
survivre au tour de l'agent.

Appeler directement `herdr pane` seulement pour diagnostiquer le routage.
