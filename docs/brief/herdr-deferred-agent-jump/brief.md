---
slug: herdr-deferred-agent-jump
status: draft
owner: mirkobozzetto
---

# Saut différé vers l'agent suivant

## En bref

Le saut vers un agent qui finit est instantané et coupe la frappe en
cours. Il doit attendre quelques secondes, et ne jamais se déclencher
tant que le clavier bouge.

## Problème

`agent-auto-jump.py` appelle `herdr agent focus` dès qu'un agent passe
`blocked`, ou de `working` à `idle`/`done`. Le seul garde-fou est
l'état de l'agent du pane regardé : il retient le saut si cet agent est
`blocked`. Rien ne regarde ce que fait la personne.

Conséquence : on est déplacé au milieu d'un prompt, d'une commande ou
d'une lecture. Le texte tapé part dans le mauvais pane ou se perd.

## Objectifs

- Ne jamais déplacer pendant une frappe active.
- Laisser quelques secondes entre le moment où un agent réclame et le
  saut, pour finir sa phrase.
- Garder le saut automatique : la cible reste l'agent le plus urgent,
  sans raccourci à presser.

## User story

En tant que développeur qui fait tourner plusieurs agents, je veux que
le saut vers un agent qui vient de finir attende que j'aie arrêté de
taper, afin de ne jamais perdre ce que j'étais en train d'écrire.

## Fonctionnement attendu

Un agent réclame l'attention. Le script note l'instant et ne saute pas
tout de suite. Il saute quand deux conditions sont vraies en même
temps : le délai d'attente est écoulé, et le clavier est silencieux
depuis 2 secondes. Si on tape sans arrêt, le saut reste en attente et
part dès la première pause.

La détection de frappe s'appuie sur le champ `revision` du pane
focalisé, exposé par `herdr pane list` : il s'incrémente à chaque
changement d'écran, donc à chaque caractère tapé.

## Réglages

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `DWELL` | 3 s | Attente entre la demande et le saut |
| `QUIET` | 2 s | Silence clavier exigé avant de sauter |
| `COOLDOWN` | 3 s | Délai entre deux sauts, existant |

## Out-of-scope

- Les notifications macOS et les plugins tiers.
- Le changement de raccourci de `next_agent`.
- Toute modification de herdr lui-même.

## Success metrics

Zéro saut subi pendant une frappe sur une semaine d'usage, contre
plusieurs par jour aujourd'hui.

## Acceptance criteria

- [ ] Aucun saut ne se produit tant que le pane focalisé change d'état
      d'écran depuis moins de 2 secondes.
- [ ] Un agent qui réclame puis repart en `working` avant la fin du
      délai n'entraîne aucun saut.
- [ ] Le saut en attente survit à plusieurs fronts d'état : il part une
      fois, vers l'agent le plus urgent.
- [ ] Les trois durées sont des constantes en tête de fichier.
- [ ] Le journal indique pourquoi un saut a été retenu, pas seulement
      les sauts effectués.
