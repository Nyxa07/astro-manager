# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Le projet est francophone : commentaires, noms de tests, messages de commit et échanges en français.

## Rôles

Sauf indication contraire de Nyxa :

- **Nyxa écrit le code applicatif.** Il découvre Electron et la manipulation de types TypeScript ; c'est un objectif du projet autant que l'application elle-même. Ce qu'il a déjà acquis et ce qu'il veut rencontrer est dans la feuille de route (« Parcours »).
- **Claude assiste** : conseil d'architecture, revue, explication des mécanismes de typage. Analyser et expliquer d'abord — n'éditer un fichier source qu'après un impératif explicite (« applique », « fais-le », « corrige »). Une question sur un choix de conception appelle une réponse, pas un patch.
- **Claude écrit les tests** la plupart du temps.
- **Claude écrit une partie de l'UI** : HTML et CSS principalement. Les composants Angular (`.ts`) reviennent à Nyxa quand il a le temps, à Claude sinon.

Quand une revue trouve un défaut, le démontrer plutôt que l'affirmer : casser volontairement le code dans une copie, montrer l'erreur du compilateur, restaurer. C'est la méthode retenue dans ce dépôt.

### Tester ses tests

Un test nouveau n'est acquis qu'après une mutation qui le fait échouer. Certaines vérifications de ce dépôt sont si structurelles qu'elles cassent la **compilation** plutôt qu'un test — par exemple retirer la garde `if (!this.api) return null` du loader de `Version` donne `TS2532`. C'est un meilleur résultat, pas un test manquant.

## Commandes

```bash
npm run dev              # ng serve + Electron sur http://localhost:4200 (--dev), DevTools ouverts
npm start                # build complet puis Electron sur app:// (mode production)
npm run build            # build:electron (typecheck + esbuild) puis build:renderer (ng build)
npm run typecheck:electron   # tsc -p tsconfig.electron.json — main + preload + shared
npm test                 # test:renderer puis test:main
npm run format           # prettier --write sur tout le dépôt (respecte .gitignore)
npm run format:check     # même chose sans écrire
```

Deux suites, deux runners — une modification côté `shared/` doit être vérifiée par les deux :

```bash
npm run test:main        # vitest, environnement node : src/{main,preload}/**/*.spec.ts
npm run test:renderer    # ng test (vitest + jsdom) : src/renderer/**/*.spec.ts
```

Lancer un seul test :

```bash
npx vitest run --config vitest.main.config.ts renderer-files   # filtre par nom de fichier
npx vitest run --config vitest.main.config.ts -t "rejette"     # filtre par nom de test
npx ng test --watch=false --filter "hors Electron"             # filtre par regex (renderer)
```

`npx tsc -p tsconfig.electron.json --noEmit` est le contrôle le plus rapide après une modification de types : les `.spec.ts` de main/preload sont dans son `include`, donc les assertions `expectTypeOf` y sont vérifiées sans exécuter les tests.

## Garde-fous

Une ligne chacun ; la mécanique et le pourquoi sont dans `docs/architecture.md` et `docs/interface.md`. Ne pas en défaire un sans le dire.

1. Le renderer ne voit ni Node ni `src/main` ; main ne voit pas le DOM ; le preload est un bundle autonome sans code par module.
2. `src/shared/ipc.ts` est la seule source de vérité des canaux ; l'exhaustivité se vérifie dans `src/main/ipc.ts`, jamais dans un module.
3. Tout argument du renderer est hostile : un validateur par canal, `null` = refus, le handler ne voit jamais des arguments non validés.
4. Le renderer n'envoie jamais un chemin de fichier ; il demande un sélecteur, main lit le chemin.
5. Le renderer est servi par `app://`, jamais `file://` ; verrou de navigation, liens externes vers le navigateur système.
6. `main/modules/` ne contient que des arêtes, dépendances injectées par fabrique et typées au plus étroit.
7. Côté renderer, seul l'injectable d'un module parle au pont ; le graphe des modules reste orienté ; le `null` d'un canal n'est pas « rien ».
8. Style : tout contre un jeton, jamais de couleur littérale, jamais de `!important`, pas de framework CSS.

## Documentation

- `docs/architecture.md` — les trois frontières, le contrat IPC, comment ajouter un module, arêtes et collaborateurs, l'organisation du renderer, les deux étages de specs, les invariants de sécurité. **À lire avant** de toucher `src/main`, `src/preload` ou `src/shared`, d'ajouter un module ou un canal, ou d'écrire une spec.
- `docs/interface.md` — le système de style, l'anatomie de l'application, les règles d'usage, les briques. **À lire avant** d'écrire du HTML, du CSS ou le gabarit d'un composant. La maquette `docs/maquette.html` montre ce qui n'est pas encore construit.
- `docs/feuille-de-route.md` — où en est le projet, la prochaine étape, les décisions, les questions ouvertes, le parcours de formation. Importée ci-dessous : elle est lue à chaque session.

@docs/feuille-de-route.md

## Conventions

- Formatage : `npm run format` avant de conclure une modification. Les réglages vivent dans `.prettierrc` et `.editorconfig` — ne pas les dupliquer ici.
- Un module porte le nom **singulier** de son concept (`workspace`, `version`), partagé par le dossier, le préfixe de canal, `<nom>Module`, `<Nom>Channel` et les types `<Nom>*`. La pluralité va dans l'opération (`workspace:list`), jamais dans le module. Un champ qui tient une collection reste au pluriel (`versions` dans `App`).
- Importer les types avec `import type` — le preload et les modules en dépendent pour l'élision (pas de `verbatimModuleSyntax`).
- Messages de commit en français, à l'impératif : « Aligne l'identité du projet sur astro-manager ».
- **Une PR qui change l'état du projet met à jour `docs/feuille-de-route.md` dans la même PR** — module livré, canal ajouté, décision prise, question tranchée. Claude propose le diff avant d'ouvrir la PR, Nyxa valide. `architecture.md` et `interface.md` ne bougent que quand une convention change, dans la PR qui la change.
