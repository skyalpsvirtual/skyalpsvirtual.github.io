# SkyAlps Virtual – site vitrine

Site public en anglais de la VA, statique (HTML/CSS/JS, sans framework) et hébergeable gratuitement.
Les statistiques des vols viennent de l'API NewSky et sont mises à jour toutes les heures par GitHub Actions.

## Contenu du dossier

| Dossier / fichier | Rôle |
|---|---|
| `site/` | **Le site à publier** (c'est tout ce qui est mis en ligne) |
| `site/assets/js/config.js` | Les seuls réglages à remplir (lien NewSky, Discord, clé carte live, e-mail) |
| `site/data/routes.json` | Réseau et horaires, **généré** depuis `data-src/` (ne pas modifier à la main) |
| `site/data/stats.json` | Stats des vols, **générées** par `scripts/fetch-newsky.mjs` |
| `data-src/timetable-2026-27.txt` | Horaires SkyAlps 2026/27 recopiés depuis le PDF (source à éditer) |
| `data-src/airports.json` | Coordonnées et noms des aéroports |
| `scripts/build_routes.py` | Horaires texte → `site/data/routes.json` |
| `scripts/build_assets.py` | Images sources (`Images/`) → images web optimisées |
| `scripts/fetch-newsky.mjs` | Récupère les vols via l'API NewSky → `site/data/stats.json` |
| `.github/workflows/newsky-sync.yml` | Tâche horaire : sync NewSky + publication sur GitHub Pages |
| `Images/`, `Routes 2026/` | Tes fichiers sources, jamais modifiés |

## Voir le site en local

```bash
python -m http.server 8080 --directory site
```

Puis ouvrir http://localhost:8080. Ouvrir `index.html` directement par double-clic ne marche pas : le navigateur bloque le chargement des données.

## Réglages (`site/assets/js/config.js`)

- `newskyJoinUrl` : l'adresse de la page « rejoindre » de la compagnie sur NewSky (`https://newsky.app/airline/<id>/join`).
  L'`<id>` est visible dans l'adresse quand tu ouvres la page de ta compagnie. Si le champ est vide, les boutons envoient vers l'inscription NewSky.
- `newskyMapToken` : une clé API NewSky avec **uniquement** la permission `map` (voir ci-dessous).
- `discordUrl` : le lien d'invitation Discord. Si le champ est vide, les boutons Discord sont masqués.
- `contactEmail` : facultatif.

## Les deux clés API NewSky

Les clés se créent dans NewSky : **Airline management → onglet General**. Une clé n'est affichée en entier qu'une seule fois, il faut la noter tout de suite.

1. **Clé « carte »**, avec la seule permission `map`. Elle va dans `config.js` et sera visible publiquement, ce qui ne pose pas de problème avec cette seule permission.
2. **Clé « vols »**, avec la seule permission `flights`. **Elle doit rester secrète** : ne la mets jamais dans un fichier du site. Elle va uniquement dans un secret GitHub (voir plus bas).

## Mise en ligne gratuite sur GitHub Pages

GitHub Pages est gratuit pour les dépôts **publics**. Le code du site sera donc visible par tous, ce qui ne pose pas de problème : la clé secrète est rangée à part, dans les secrets GitHub.
Git n'est pas installé sur ce PC. Tout se fait depuis le site de GitHub, ou avec [GitHub Desktop](https://desktop.github.com/) si tu préfères.

1. Crée un compte sur [github.com](https://github.com) si besoin, puis **New repository** : nom `skyalps-virtual`, visibilité **Public**, sans cocher « Add a README ».
2. Sur la page du dépôt vide, clique sur **uploading an existing file**.
   Dans l'Explorateur, sélectionne **`.github`, `data-src`, `scripts`, `site` et `README.md`**, glisse-les dans la page, puis clique sur **Commit changes**.
   - Ne glisse pas le dossier « SkyAlps Virtual » lui-même : tout se retrouverait dans un sous-dossier et GitHub ne trouverait pas la tâche automatique.
   - `Images`, `Routes 2026` et `.claude` ne servent qu'en local : inutile de les envoyer.
3. Vérifie que le dossier `.github/workflows` apparaît bien dans la liste des fichiers du dépôt.
   S'il manque : **Add file → Create new file**, tape `.github/workflows/newsky-sync.yml` comme nom (les `/` créent les dossiers), colle le contenu du fichier, puis **Commit changes**.
4. **Settings → Pages → Build and deployment → Source** : choisis **GitHub Actions**.
5. **Settings → Secrets and variables → Actions → New repository secret** : nom `NEWSKY_API_KEY`, valeur = la clé « vols ».
   Cette étape peut attendre : sans clé, le site est publié quand même, avec des stats vides.
6. **Actions → Newsky sync & deploy → Run workflow**. Au bout d'une à deux minutes, une coche verte apparaît.
   La toute première exécution, lancée automatiquement par l'envoi des fichiers, échoue (croix rouge) car Pages n'était pas encore activé : c'est normal, ignore-la.
7. Le site est en ligne à l'adresse `https://<ton-pseudo>.github.io/skyalps-virtual/`, rappelée dans Settings → Pages.
   Un nom de domaine personnalisé (payant, environ 10 € par an) peut être ajouté plus tard au même endroit.

Ensuite, la tâche tourne toute seule toutes les heures. Elle ne publie une nouvelle version que si un vol a changé.
À savoir : GitHub met en pause les tâches planifiées d'un dépôt public sans aucune activité pendant 60 jours. Il suffit alors de les réactiver dans l'onglet Actions.

### Modifier le site après la mise en ligne

- Pour un petit changement (remplir `config.js`, corriger un texte) : ouvre le fichier sur GitHub, clique sur le crayon, modifie, puis **Commit changes**. Le site se republie tout seul en une à deux minutes.
- Si tu renvoies des fichiers depuis ton PC, n'envoie pas `site/data/stats.json` : la version du dépôt est tenue à jour par la tâche automatique, la tienne est vide.

## Première vérification du format des vols

La documentation de l'API ne décrit pas le contenu d'un vol. Le script lit donc les champs utilisés par l'interface NewSky, avec des solutions de repli.
Une fois les premiers vols enregistrés, lance ceci **sur ton PC** (pas dans GitHub, car les journaux d'Actions d'un dépôt public sont visibles par tout le monde) :

```bash
$env:NEWSKY_API_KEY = "ta-clé-vols"; node scripts/fetch-newsky.mjs --inspect
```

Le script affiche la structure d'un vol réel et le résultat de la conversion. Si une valeur paraît fausse (durée, note), envoie-moi cette sortie **sans la clé** et j'ajusterai la lecture.

Par défaut, les pilotes s'affichent sous la forme « Prénom N. ». Pour afficher le nom complet, ajoute la variable `NEWSKY_PILOT_NAMES: full` dans le workflow.

## Mettre à jour les horaires (nouvelle saison)

1. Recopie les nouvelles lignes dans `data-src/timetable-2026-27.txt` (ou dans un nouveau fichier au même format). Le format est expliqué en tête de fichier.
2. Si un nouvel aéroport apparaît, ajoute-le dans `data-src/airports.json`.
3. Lance :

```bash
python scripts/build_routes.py
```

Le script affiche toutes les routes avec leur distance et leur temps de vol, pour vérifier d'un coup d'œil.

## Régénérer les images

Si tu changes un visuel dans `Images/` (bannière, logo), relance :

```bash
python scripts/build_assets.py
```

## Points à valider avant publication

- **FAQ « VATSIM / IVAO »** : j'ai mis « bienvenus mais jamais obligatoires ». C'est un choix de règlement, change-le si ce n'est pas ta politique.
- **Image et marque SkyAlps** : la photo et le logo appartiennent à SkyAlps. Le pied de page précise que la VA n'est pas affiliée à la compagnie.
  Demander l'accord de SkyAlps est recommandé. NewSky donne d'ailleurs la priorité aux VA soutenues officiellement par la vraie compagnie pour obtenir le vrai code OACI (SWU).
- **Aperçu Discord / réseaux sociaux** : une fois l'adresse du site connue, remplace `assets/img/og-image.jpg` par l'adresse complète
  (`https://<ton-pseudo>.github.io/skyalps-virtual/assets/img/og-image.jpg`) dans la balise `og:image` de `site/index.html`.
  Discord et Facebook n'affichent l'image qu'avec une adresse complète.
- Les horaires viennent du PDF officiel publié le 15/09/2026. Une erreur de date a été corrigée : Bolzano–Brindisi, ligne du dimanche, période du 17/05 au 19/07.
