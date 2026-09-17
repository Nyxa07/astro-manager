# Feuille de route

Où en est le projet et où il va. Importée dans chaque session par `CLAUDE.md` : rester court. Se met à jour dans la PR qui change l'état du projet — un module livré, un canal ajouté, une décision prise, une question tranchée.

L'application vise la gestion d'une bibliothèque de photo astronomique : rangement des clichés en place, scripts Siril et Python, publication. Elle est aussi le terrain de formation de Nyxa à Electron et au typage TypeScript.

## En place

- **Socle** — trois frontières, contrat IPC dérivé d'`IPC`, preload générique, protocole `app://`, verrou de navigation, `database.ts` (migrations sous `PRAGMA user_version`, `application_id` `ASTM`), deux suites de specs.
- **`version`** — `version:get`. Module d'exemple, affiché sur l'accueil.
- **`workspace`** — `workspace:open`, `reopen`, `list`, `current`, `forget`. Registre JSON des espaces connus dans `userData` ; identité de l'espace (id, nom) dans `<racine>/.astro-manager/library.db`, table `workspace`, schéma v1 ; session courante côté main. Côté renderer : injectable `Workspace`, écran d'accueil (sélecteur, espaces récents, oubli d'un récent).
- **Renderer** — jetons et trois thèmes, socle et briques CSS, pont par injection (`ELECTRON_API`), `App` aiguillé sur `workspace.current()`. La coquille n'existe qu'en maquette.

## Prochaine étape — `picture`

Le cœur du logiciel et le premier module qui dépend d'un autre. Conçu le 17 septembre 2026 en séance de questions ; livré en quatre PR, chacune mettant cette page à jour.

**Ce que c'est.** Une ligne = un fichier, référencé par son chemin relatif à la racine (séparateur `/`), sa sorte — `fits`, `raw`, `tiff`, `jpeg`, `png` —, sa taille et sa date. Balayage **à la demande**, exhaustif sous la racine ; ignore les entrées cachées, `.astro-manager/` et les liens symboliques ; ne lit aucun en-tête et ne donne aucun sens aux dossiers. Disparu → retiré ; modifié → vignette invalidée ; déplacé → retiré puis ajouté. Les intermédiaires Siril sont des FITS comme les autres (leur en-tête `PROGRAM`/`HISTORY` les distinguera au catalogue).

**Les quatre PR.**

1. **Session injectée** — `Session` construite dans `index.ts`, passée à `registerIpcHandlers` puis aux fabriques ; `current()` rend `{ info, db }`. Refactor pur ; `architecture.md` suit.
2. **`picture` main + shared** — migration v2 (table `picture`) ; `walk` (générateur asynchrone, événements `added | changed | removed`), `store`, une transaction ; `picture:scan` → résumé, `picture:list` ; `null` = aucun espace ouvert. Injectable `Picture` (`all`, `scan()`, `scanning`, `selected`), sans écran.
3. **`workspace://` et vignettes** — deux hôtes, `file/<chemin relatif>` et `thumb/<id>` ; résolution pure, réponse en flux, privilèges `standard` + `stream`, CSP `img-src`. Vignettes `.astro-manager/thumbs/<id>.jpg` (360 × 240) générées sur défaut de cache : FITS par un lecteur maison (en-tête, lectures échantillonnées, étirement par percentiles, superpixel si `BAYERPAT`), JPEG/PNG par `nativeImage`, RAW/TIFF en tuile de remplacement ; échec mémorisé pour la session, orphelines purgées au balayage. Seconde arête du module ; `architecture.md` suit.
4. **Coquille et grille** — `app/shell/` (barre supérieure, rail réduit aux écrans existants, `<router-outlet>`, inspecteur, barre d'état), routes internes `'' → picture`, grille virtualisée **par rangées** (`@angular/cdk`, colonnes dérivées d'un `ResizeObserver`), inspecteur minimal (nom, chemin, sorte, taille, date), « Balayer » dans l'entête de l'écran ; `interface.md` suit.

## Ensuite

Ordre indicatif, révisable.

1. **Catalogue** — métadonnées lues des fichiers (en-têtes FITS, EXIF), objets et nuits comme axes de rangement, filtres.
2. **Ingestion** — « Importer une nuit… » : copier depuis un support (carte, ASIAIR) _vers_ l'espace, la seule copie prévue, depuis l'extérieur.
3. **Scripts** — Siril et Python : les _ranger_ d'abord ; les _lancer_ est une frontière de sécurité de plus (arguments, chemins, sortie), à concevoir à part.
4. **Publication** — export, cible à définir.
5. **Réglages** — thème persistant, puis le reste quand il existera.

## Décisions prises

- **Aucune copie de fichiers.** La base référence les images en place, en chemins relatifs à la racine : l'espace reste déplaçable et l'utilisateur garde son rangement.
- **Persistance sur deux étages.** `app.getPath('userData')` pour la liste des espaces connus — le seul chemin absolu du système —, `<workspace>/.astro-manager/library.db` pour le catalogue.
- **L'identité d'un espace vit dans sa base**, pas dans le registre : un espace déplacé se réidentifie à la réouverture, le registre n'est qu'un cache de chemins.
- **`node:sqlite`** — disponible sans flag dans Electron 44 / Node 24.20.0, aucun module natif à recompiler. Schéma versionné par `PRAGMA user_version` dès la première migration, signé par `application_id`.
- **Le renderer n'envoie jamais un chemin** ; les fichiers de l'espace lui parviennent par `workspace://`.
- **`picture`, pas `image`.** `Image` masque le global du DOM ; « picture » est le mot le plus proche de « cliché » et garde le singulier.
- **`workspace://` a deux hôtes** — `file/<chemin relatif>` pour un original, `thumb/<id>` pour une vignette : le renderer ne construit pas de chemin pour une tuile, et `library.db` est inatteignable.
- **Les vignettes vivent dans l'espace** (`.astro-manager/thumbs/`), générées à la demande par le handler `thumb` — rien n'est calculé pour ce qu'on ne regarde pas.
- **Aucune sémantique de dossier, aucun classement demandé à l'utilisateur.** Le rattachement (type de pose, objet, nuit) se lit dans les en-têtes FITS, au catalogue.
- **L'accueil est un état, pas une URL** ; le routeur ne sert qu'à l'intérieur de l'espace.
- **CSS natif, trois thèmes, Plex auto-hébergé** — voir `interface.md`.
- **Pas d'outillage de mémoire externe.** graft essayé et retiré, claude-mem écarté : la mémoire du projet, c'est `docs/` et `git log`.

## Questions ouvertes

- ESLint : `noUnusedLocals` n'est pas réglé, aucun lint au-delà de `tsc` et Prettier.
- Un script npm pour `madge --circular` ?
- Devenir de `version` : module d'exemple, à garder pour un écran « À propos » ou à retirer.
- « Projet » ou « traitement » — brutes, calibrations, intermédiaires et résultat d'un même objet : à modéliser quand les scripts auront des entrées et des sorties.
- État `missing` d'un cliché disparu, le jour où une ligne portera quelque chose à ne pas perdre.
- Décodage RAW (aperçu JPEG embarqué) et TIFF pour les vignettes.
- Événements main → renderer pour une tâche longue (balayage surveillé, script) : le contrat IPC ne modélise que l'aller-retour.

## Parcours

Ce que Nyxa a déjà manipulé — l'agent ne le réexplique pas sans demande — et ce qu'il veut rencontrer. L'agent y pioche quand le code s'y prête, sans forcer.

**Acquis** : mapped types et `ChannelsOf` ; annotation sur la variable vs `satisfies` ; variance et validateur partagé (`NoArgChannel`) ; `Handler<C>` comme couture ; `InjectionToken` vs classe injectable ; signaux et `asReadonly()` ; `resource` ; deux étages de specs ; cycles d'injection vs cycles d'import.

**À rencontrer** :

1. Unions discriminées et `switch` exhaustif (`never`) — `PictureKind`, les événements d'un balayage.
2. Template literal types — typer `workspace://file/<chemin relatif>` et `workspace://thumb/<id>` pour qu'un chemin absolu soit refusé à la compilation.
3. `node:sqlite` typé — lignes de base vs types de domaine, migrations, `satisfies` sur un schéma.
4. `protocol.handle` avec `Response` et flux — servir un fichier sans le charger en mémoire, et le tester sans Electron.
5. Générateurs asynchrones (`async function*`) pour un balayage progressif, et comment on teste une itération.
6. Angular : `resource` à `params` dépendant de `workspace.current()`, `linkedSignal`/`computed`, virtual scroll CDK par rangées.
