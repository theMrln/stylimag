# Stylo [![Coverage Status](https://coveralls.io/repos/github/EcrituresNumeriques/stylo/badge.svg?branch=master)](https://coveralls.io/github/EcrituresNumeriques/stylo?branch=master) [![tests](https://github.com/EcrituresNumeriques/stylo/actions/workflows/node.yml/badge.svg)](https://github.com/EcrituresNumeriques/stylo/actions/workflows/node.yml)

Stylo est un éditeur de textes pour articles scientifiques en sciences humaines et sociales.

L'environnement de travail de Stylo intègre une chaîne éditoriale complète basée sur [pandoc](http://pandoc.org/) et outillée des modules suivants :

- un éditeur de métadonnées
- un versionnage
- une gestion de la bibliographie
- différents formats exports : html5, xml (TEI, Erudit), pdf...
- l'annotation
- le partage de document

Stylo est disponible sur [stylo.huma-num.fr](https://stylo.huma-num.fr)

Plus d'informations sur [la documentation](http://stylo-doc.ecrituresnumeriques.ca/).

# Pré-requis

- Node.js v24+
- MongoDB 7

## Sous MacOS

```bash
brew tap mongodb/brew

brew install mongodb-community nvm
brew install --cask docker

nvm install v24 --default
```

# Développement local

L'application se lance en combinant une base de données MongoDB, et des applications Node.js (v18+).

**La première fois que vous installez le projet**, lancez ces commandes :

```bash
cp stylo-example.env .env
npm clean-install
npm --prefix front clean-install
npm --prefix graphql clean-install
```

## Sans Docker

Avant un premier lancement, la variable `SE_GRAPHQL_TOKEN` doit être renseignée dans `.env` à l'aide de la valeur produite par cette commande :

```bash
DOTENV_CONFIG_PATH=.env NODE_OPTIONS="--require dotenv/config" npm run --prefix graphql generate-service-token --silent
```

Ensuite, ainsi que le reste du temps :

```bash
mongod --config /usr/local/etc/mongod.conf --fork
npm run dev
```

## Avec Docker

Avant un premier lancement, la variable `SE_GRAPHQL_TOKEN` doit être renseignée dans `.env` à l'aide de la valeur produite par cette commande :

```bash
docker compose run -ti --build --rm graphql-stylo npm run generate-service-token --silent
```

Ensuite, ainsi que le reste du temps :

```bash
docker compose up mongodb-stylo export-stylo pandoc-api
npm run dev
```

### Démarrer localement avec des images Docker Hub (sans build local)

Si vous avez déjà publié les images `graphql` et `front` sur Docker Hub, utilisez le script suivant depuis la racine du dépôt :

```bash
./scripts/docker-run-from-hub.sh --user <dockerhub_user> --tag <tag>
```

Le script :
- crée `.env` et `config/ojs.json` depuis les fichiers d'exemple s'ils sont absents
- fait le `docker pull` des images `stylimag-graphql` et `stylimag-front`
- applique les tags locaux attendus par `docker-compose.yml`
- lance `docker compose up -d --no-build mongo graphql front`

Accès local :
- Frontend : http://localhost:3000
- GraphQL : http://localhost:3030

Pour mettre à jour vers une nouvelle version, relancez simplement avec un autre tag :

```bash
./scripts/docker-run-from-hub.sh --user <dockerhub_user> --tag <new_tag>
```

Options utiles :

```bash
./scripts/docker-run-from-hub.sh --user <dockerhub_user>             # tag latest
./scripts/docker-run-from-hub.sh --user <dockerhub_user> --no-up     # pull + tag uniquement
./scripts/docker-run-from-hub.sh --user <dockerhub_user> --skip-bootstrap
```

Si vous changez de machine (ou si Docker semble réutiliser une version trop ancienne des images), utilisez le script de reset Docker depuis la racine du dépôt :

```bash
./scripts/docker-reset.sh
```

Ce script met à jour la branche (`git pull --ff-only`), reconstruit les images locales et recrée les conteneurs.

## Publier les images sur Docker Hub

Depuis la racine du dépôt, utilisez le script :

```bash
./scripts/docker-push-images.sh --user <dockerhub_user>
```

Ce script automatise les étapes suivantes :
- connexion Docker Hub (`docker login`)
- build des images `graphql` et `front` via `docker compose`
- tag des images avec le SHA git courant (et `latest` par défaut)
- push des tags sur Docker Hub
- vérification par `docker pull`

Options utiles :

```bash
./scripts/docker-push-images.sh --user <dockerhub_user> --tag v1.2.0
./scripts/docker-push-images.sh --user <dockerhub_user> --tag v1.2.0 --no-latest
./scripts/docker-push-images.sh --user <dockerhub_user> --skip-login
```

Note : Mongo utilise l'image officielle `mongo:6` définie dans `docker-compose.yml` (pas une image buildée localement), donc ce script ne pousse pas d'image Mongo.

## Scripts Docker utiles

Depuis la racine du dépôt :

- `./scripts/docker-reset.sh` : nettoie/reconstruit la stack Docker locale (inclut `git pull --ff-only`).
- `./scripts/docker-push-images.sh --user <dockerhub_user> [--tag <tag>]` : build, tag et push les images `graphql` et `front` vers Docker Hub.
- `./scripts/docker-run-from-hub.sh --user <dockerhub_user> [--tag <tag>]` : pull les images publiées, applique les tags locaux attendus et lance la stack sans rebuild.

L'[interface web de Stylo](./front) est alors disponible sur ([`localhost:3000`](http://localhost:3000)).<br>
L'[API GraphQL](./graphql) fonctionne sur [`localhost:3030`](http://localhost:3030/) et le [service d'export](./export) sur [`localhost:3080`](http://localhost:3080/).

# Installation

Pour installer une instance Stylo en tant que service à disposition d'utilisateur·ices, veuillez suivre la documentation dédiée dans le fichier [`HOWTO.md`](HOWTO.md).

---

[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FEcrituresNumeriques%2Fstylo.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FEcrituresNumeriques%2Fstylo?ref=badge_shield)

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FEcrituresNumeriques%2Fstylo.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FEcrituresNumeriques%2Fstylo?ref=badge_large)
