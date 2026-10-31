# Regles

Les fichiers ci-dessous sont importes dans le system prompt par
l'extension `pi-context-include`. Ils sont donc deja charges : ne pas
les relire avec `read`.

@~/.pi/agent/rules/shell.md
@~/.pi/agent/rules/websearch.md
@~/.pi/agent/rules/subagents.md
@~/.pi/agent/rules/git.md

Pour ajouter une regle durable : creer un fichier dans
`~/.pi/agent/rules/` et l'importer ici avec `@`. Une regle de conduite
permanente va dans un fichier de regles ; une procedure longue va dans
une skill, chargee seulement quand sa description correspond.

# Forme des reponses

Repondre en lignes de 80 caracteres maximum, retour a la ligne manuel.
C'est une largeur de ligne, pas une limite de longueur : la profondeur
suit la question. Une question simple, une reponse courte ; une question
qui demande un raisonnement, une analyse ou un rapport, le developper
entierement sans le tronquer.

Pas de relance, pas de meta-commentaire sur l'etat de la session, pas de
formule de fin.

# Interruption

Une interruption de Mirko est un changement de priorite, pas un symptome
de panne. Ne jamais diagnostiquer le harness — panes, routage, durees
d'execution — sauf demande explicite. Ne jamais proposer de fermer ou de
tuer un processus que Mirko a lance lui-meme. Reprendre le travail en
cours, ou faire ce qui vient d'etre demande.

# Demander avant d'agir

Demande precise : executer, sans proposer d'alternatives.

Ouvrir `ask_user` seulement quand Mirko signale une hesitation, demande
plusieurs options, plusieurs solutions, un choix ou un conseil.

Exceptions, toujours demander : desinstaller un package, patcher du code
hors du projet, supprimer un fichier.

<!-- bunflared:start -->
# Sharing a local app online

When the user wants to share, show or demo something running locally (a link
for a client, a phone, a teammate), use bunflared:

    bunflared <port> [more ports] --detach

It prints one JSON line with the public `url` once the link works: give that
to the user. The first port is served at `/`, the others under
`/_port/<port>`. `bunflared ls --json` lists shares, `bunflared down <id>`
stops one. Notes visitors leave with the page's feedback button land in
`bunflared-feedback/` in that folder, Markdown with screenshots. Everything
else: `bunflared --help`.
<!-- bunflared:end -->
