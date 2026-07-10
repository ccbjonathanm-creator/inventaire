# Inventaire

Appli web locale pour faire l'inventaire de pièces à partir d'un fichier Excel, sur PC (Windows 10/11, Chrome ou Edge). **Tout reste sur le PC**, rien n'est envoyé sur internet, sauf la reconnaissance vocale au moment où on dicte (voir plus bas).

## Ce que ça fait

1. **Import Excel/CSV** : glisse ton fichier d'inventaire. L'appli **détecte automatiquement** les colonnes (Référence, Désignation, Emplacement, Quantité théorique), quel que soit le nom des colonnes. Tu peux corriger la détection avant de démarrer.
2. **Comptage** : recherche/filtre une pièce, saisis la quantité comptée **au clavier** ou **à la voix**.
3. **Écarts en direct** : l'appli compare le compté au théorique et affiche l'écart (OK / manquant / surplus) + une barre de progression et le nombre d'écarts.
4. **Export Excel** : réexporte un fichier avec **tes colonnes d'origine intactes** + `Compté` + `Écart` + `Statut`, nom de fichier horodaté.
5. **Reprise** : si tu fermes l'appli, elle propose de reprendre l'inventaire en cours (sauvegarde locale automatique).

## Saisie vocale (mains libres)

- Clique sur le 🎤 d'une ligne (ou appuie sur **Espace** hors d'un champ), dis le nombre ("douze", "quarante-huit", "cent vingt"), ça s'écrit et valide, puis ça passe **à la pièce suivante non comptée**.
- Comprend les chiffres, les nombres en toutes lettres (jusqu'aux milliers, y compris "quatre-vingt-dix"), et "rien / aucun" = 0.

### Deux contraintes de la voix (à savoir)
- **Internet requis au moment de dicter** : Chrome/Edge envoient l'audio à leur service de transcription. Le reste de l'appli marche hors-ligne. (Pour un inventaire, ce ne sont que des chiffres, aucune donnée sensible.)
- **Le micro n'est autorisé qu'en HTTPS** (ou sur `localhost`). En ouvrant simplement le fichier en local (`file://`), le micro sera bloqué. Pour l'utiliser au quotidien, l'héberger en HTTPS (GitHub Pages, comme les autres apps) est le plus simple. La **saisie clavier marche partout**, elle, y compris hors-ligne.

## Lancer en local (test)

```
python -m http.server 5074 --bind 127.0.0.1 --directory inventaire_app
```
puis ouvrir http://localhost:5074 (la voix marche sur localhost car c'est un contexte sécurisé).

## Fichiers

- `index.html` / `styles.css` / `app.js` : l'appli.
- `vendor/xlsx.full.min.js` : SheetJS embarqué en local (lecture/écriture Excel, aucun code distant).

## Sécurité

CSP stricte : aucun script distant, `connect-src 'self'` (la reconnaissance vocale passe par l'API native du navigateur, pas par une requête réseau de l'appli). Même esprit que Coffre/Valise : tout est embarqué.
