---
slug: herdr-deferred-agent-jump
brief: brief.md
status: todo
---

# Tasks

Do NOT implement until asked.

## Relevant Files

- `herdr/agent-auto-jump.py` — le script, lié vers
  `~/.config/herdr/agent-auto-jump.py`
- `herdr/dev.herdr.agent-auto-jump.plist` — le LaunchAgent qui le lance

## Tasks

- [ ] 1.0 Détecter l'activité clavier
  - [ ] 1.1 Lire `revision` du pane focalisé dans `herdr pane list`
  - [ ] 1.2 Mémoriser la dernière valeur et l'instant où elle a changé
  - [ ] 1.3 Exposer `keyboard_quiet_for(seconds)` sur cette base
- [ ] 2.0 Différer le saut
  - [ ] 2.1 Ajouter `DWELL` et `QUIET` en tête de fichier
  - [ ] 2.2 Remplacer le saut immédiat par une demande en attente,
        avec son instant et son pane
  - [ ] 2.3 Déclencher le saut quand `DWELL` est écoulé et le clavier
        silencieux depuis `QUIET`
  - [ ] 2.4 Annuler la demande si l'agent repart en `working`
- [ ] 3.0 Journal
  - [ ] 3.1 Écrire la raison d'un saut retenu, une fois par épisode
- [ ] 4.0 Vérification
  - [ ] 4.1 Taper en continu pendant qu'un agent finit : aucun saut
  - [ ] 4.2 Arrêter de taper : le saut part dans les 2 secondes
  - [ ] 4.3 `launchctl kickstart` et relire le journal
