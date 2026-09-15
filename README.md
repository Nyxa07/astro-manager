# astro-manager

Gestion d'une bibliothèque de photo astronomique : rangement des clichés en place — sans copie —, scripts Siril et Python, publication. Application de bureau Electron + Angular.

Le projet a deux objectifs : le logiciel, et la formation de son auteur à Electron et au typage TypeScript. Le code applicatif est écrit à la main ; Claude Code assure la revue, les tests et l'interface.

## Démarrer

```bash
npm install
npm run dev      # développement : ng serve + Electron, DevTools ouverts
npm start        # build complet puis Electron sur app://
npm test         # les deux suites de specs
```

## Documentation

- [`docs/feuille-de-route.md`](docs/feuille-de-route.md) — où en est le projet et où il va.
- [`docs/architecture.md`](docs/architecture.md) — frontières, contrat IPC, modules, tests, invariants de sécurité.
- [`docs/interface.md`](docs/interface.md) — système de style et anatomie de l'interface ; la maquette est [`docs/maquette.html`](docs/maquette.html).
- [`CLAUDE.md`](CLAUDE.md) — consignes pour l'agent.
