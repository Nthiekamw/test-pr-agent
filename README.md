# Agent de revue de PR

Agent autonome : à chaque pull request, il lit le diff, creuse les fichiers douteux
et publie une revue. Il ne peut ni approuver ni merger.

## Installation (10 min)
1. Crée un dépôt GitHub de test et copie ce dossier dedans (le dossier `.github` compris).
2. Ajoute le secret `GEMINI_API_KEY`.
3. Crée une branche, modifie du code (voir "PR pièges"), ouvre une pull request.
4. Onglet Actions : regarde les logs JSON défiler. La revue apparaît sur la PR.

## PR pièges pour la démo
- Une fonction avec une requête SQL construite par concaténation (faille).
- Une division sans vérifier si le diviseur vaut 0.
- Une PR énorme (50 fichiers) pour voir la limite d'étapes déclencher l'escalade.

## Garde-fous
- Écriture limitée à un commentaire de revue (event COMMENT, jamais APPROVE).
- 12 étapes max, 40 000 tokens de sortie max, 5 min de timeout.
- Sorties d'outils tronquées à 15 000 caractères.
- Si ça déraille : commentaire "relecture humaine nécessaire" + job en échec.
