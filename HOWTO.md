# How to install Stylo

Depending on your needs, you may want to install Stylo in different ways :

- [With Docker](#run-with-docker) (suited to run Stylo rapidly)
- [Without Docker](#run-without-docker) (suited to tailor your Stylo setup)

[Ansible playbooks](#deploy-with-ansible) enable you to deploy Stylo on a remote machine, accessible with the SSH protocol.

You can find various pointers in our [GitHub Actions automations](./.github/workflows/deploy.yml), and in the [`./infrastructure` folder](./infrastructure).

## Clone git project

First step is to clone the project, you can use either the HTTPS or SSH version of the repository URL:

    $ git clone git@github.com:EcrituresNumeriques/stylo.git

## Run with Docker

Useful to run a fully fledged Stylo in no time.

Run the following command:

    $ cp stylo-example.env .env
    $ docker-compose up

**NOTE:** The first time, this command can take a few dozen minutes depending on your network speed and machine capabilities. Subsequent calls will be faster.

This gives your access to:

- Stylo (frontend): http://localhost:3000
- GraphQL endpoint: http://localhost:3030
- Export endpoint: http://localhost:3080
- Pandoc API: http://localhost:3090

### Export + Pandoc API (preview and “Exporter”)

The frontend calls **Stylo’s export HTTP API** on **`http://127.0.0.1:3080`** (see `SNOWPACK_PUBLIC_PANDOC_EXPORT_ENDPOINT` in `stylo-example.env` and the `front` build args in `docker-compose.yml`). That API is **not** the generic “Pandoc HTTP” service on port 8000; upstream runs two images:

| Service       | Image (default)              | Host port | In-container port | Role |
|---------------|------------------------------|-----------|-------------------|------|
| `export`      | `davidbgk/stylo-export:3.6.3` | **3080**  | 8001              | Stylo `/api/*` preview + export |
| `pandoc-api`  | `davidbgk/pandoc-api:3.3.0`   | **3090**  | 8000              | Pandoc conversion used by `export` |

Wiring matches **`docker-compose.old.yaml`** / **`infrastructure/templates/docker-compose.yaml`**: `export` talks to Pandoc via **`SE_PANDOC_API_BASE_URL`** (default `http://pandoc-api:8000/latest/`), and only fetches instance URLs allowed by **`SE_ALLOWED_INSTANCE_BASE_URLS`**. Set **`SE_GRAPHQL_TOKEN`** in `.env` before first use (see [README](./README.md) — `generate-service-token`).

Start the stack including export:

```bash
docker compose up -d mongo minio graphql front pandoc-api export
```

Optional overrides (examples): `STYLO_EXPORT_IMAGE`, `PANDOC_API_IMAGE`, `SE_PANDOC_API_BASE_URL`, `SE_ALLOWED_INSTANCE_BASE_URLS`, `SE_CANONICAL_BASE_URL`.

### Lite (client-only) preview — run without the export stack

The preview panel can render Markdown entirely in the browser using
[markdown-it](https://github.com/markdown-it/markdown-it) + [DOMPurify](https://github.com/cure53/DOMPurify),
so you can work with a minimal local stack (`mongo + minio + graphql + front`) and skip the `export` + `pandoc-api` containers.

Selection is controlled by `SNOWPACK_PUBLIC_PREVIEW_ENGINE`:

| Value    | Behaviour                                                                         |
|----------|-----------------------------------------------------------------------------------|
| `auto`   | Default. Use the pandoc export service when reachable, fall back to lite.         |
| `lite`   | Always render client-side. No export endpoint required.                           |
| `export` | Always require the pandoc export endpoint (`SNOWPACK_PUBLIC_PANDOC_EXPORT_ENDPOINT`). |

On `auto`, users also get an in-app toggle in the preview toolbar to switch engines on demand (shown only when both are available).

**What lite preview does not do** (on purpose):

- No citeproc / BibTeX: `[@key]` stays literal.
- No Pandoc filters or YAML-driven templates.
- Footnotes render via a GitHub-style subset (markdown-it-footnote).
- Output may differ from the exported article — the UI shows an "approximate preview" banner.

For full fidelity (citations, filters, PDF), keep the export stack running locally or point `SNOWPACK_PUBLIC_PANDOC_EXPORT_ENDPOINT` at a hosted Stylo export URL.

### Run locally from prebuilt Docker Hub images (no local build)

If you already have published app images on Docker Hub, run Stylo locally without rebuilding `graphql` and `front`:

    $ ./scripts/docker-run-from-hub.sh --user <dockerhub_user> --tag <tag>

Equivalent manual steps:

1. Pull/run images (pull published images and prepare compose image names):

    $ docker pull <dockerhub_user>/stylimag-graphql:<tag>
    $ docker pull <dockerhub_user>/stylimag-front:<tag>
    $ docker tag <dockerhub_user>/stylimag-graphql:<tag> stylimag-graphql:latest
    $ docker tag <dockerhub_user>/stylimag-front:<tag> stylimag-front:latest

2. Create local `config/ojs.json` from `config/ojs.example.json`:

    $ cp config/ojs.example.json config/ojs.json

3. Fill real `api_endpoint` and `api_token` values in `config/ojs.json`.

4. Start compose (which mounts `./config` into the GraphQL container as read-only):

    $ docker compose up -d --no-build mongo graphql front

This script:
- bootstraps `.env` and `config/ojs.json` from example files if missing
- pulls `<dockerhub_user>/stylimag-graphql:<tag>` and `<dockerhub_user>/stylimag-front:<tag>`
- tags them locally as `stylimag-graphql:latest` and `stylimag-front:latest` (expected by compose)
- starts `docker compose up -d --no-build mongo graphql front`

To upgrade later, run it again with another tag:

    $ ./scripts/docker-run-from-hub.sh --user <dockerhub_user> --tag <new_tag>

Other variants:

    $ ./scripts/docker-run-from-hub.sh --user <dockerhub_user>          # default tag: latest
    $ ./scripts/docker-run-from-hub.sh --user <dockerhub_user> --no-up  # pull + tag only

Troubleshooting OJS:
- If OJS import fails with `OJS configuration missing for instance "...". Check config/ojs.json`, ensure `config/ojs.json` exists, is valid JSON, and includes `api_endpoint` and `api_token` for the selected instance (`staging` or `production`).

## Run without Docker

**Note**: this section can be improved.

We recommend you to host Stylo **behind a reverse proxy**.
We provide a working configuration example below for the Nginx server.

### Install the pre-requisite

    $ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    $ nvm install v16
    $ sudo apt install mongodb-org pandoc

### Prepare the server

After _cloning_ the repo, build the service and its dependencies:

    $ cp stylo-example.env .env
    $ npm clean-install
    $ npm start

After the image is built, you should have a Stylo instance running on your server.
Now, we need to expose it to the outside world with a reverse proxy.

### Expose online

Obtain a working sample file with the following command:

    $ wget -O /etc/nginx/sites-available/stylo.conf \
        https://github.com/EcrituresNumeriques/stylo/raw/dev/infrastructure/stylo.huma-num.fr.conf

Replace the service domain name:

    $ sed -i s/stylo.huma-num.fr/STYLO_SUBDOMAIN.MYDOMAIN.TLD/g' /etc/nginx/sites-available/stylo.conf

Alternatively, alter the various ports, and domains on your own.

When you are done, enable the website and reload the configuration:

    $ ln -s /etc/nginx/sites-available/stylo.conf /etc/nginx/sites-enable/stylo.conf
    $ nginx reload

## Deploy with Ansible

**Note**: this section can be improved.

    $ pip install ansible===2.9.7 requests
    $ cd infrastructure
    $ ansible-playbook -i inventories/prod playbook.yml

## Publish Docker images to Docker Hub

If you want to publish the app images built from this repository (`graphql` and `front`) to Docker Hub, use:

    $ ./scripts/docker-push-images.sh --user <dockerhub_user>

This script performs:
- Docker Hub login (`docker login`)
- `docker compose build graphql front`
- image tagging with current git short SHA (and `latest` by default)
- push to Docker Hub
- pull verification

Common variants:

    $ ./scripts/docker-push-images.sh --user <dockerhub_user> --tag v1.2.0
    $ ./scripts/docker-push-images.sh --user <dockerhub_user> --tag v1.2.0 --no-latest
    $ ./scripts/docker-push-images.sh --user <dockerhub_user> --skip-login

Note: Mongo is referenced as upstream `mongo:6` in compose and is not built/pushed by this script.

## Docker persistence model

- MongoDB data is persisted in the Docker named volume `mongo_data` (`mongo_data:/data/db`).
- Object storage (MinIO) is persisted in the Docker named volume `minio_data` (`minio_data:/data`). It backs binary assets (images dropped into articles) and generated exports (HTML/PDF, stubbed for now).
- OJS config is persisted on the host in `config/ojs.json`, mounted read-only into GraphQL (`./config:/usr/src/app/config:ro`).
- Environment values are persisted on the host in `.env` (loaded via `env_file`). `STORAGE_*` variables control how GraphQL talks to the object store (endpoint, bucket, credentials).
- `front` and `graphql` application files live in image layers; runtime writes inside containers are ephemeral unless explicitly mounted to a volume.

### Object storage (images and exports)

Images dropped into the Markdown editor are uploaded to the backend (`POST /assets/images`), persisted in MinIO (default bucket `stylimag-assets`), and referenced in Markdown via stable platform URLs served by GraphQL (`/assets/images/{id}`). If object storage is not configured and `SNOWPACK_IMGUR_CLIENT_ID` is set, the frontend falls back to Imgur.

- The MinIO console is exposed locally on [`http://localhost:9001`](http://localhost:9001) (credentials: `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`).
- The bucket is created automatically on first upload if missing.
- Generated export artifacts (HTML/PDF) are persisted via `POST /assets/exports` (multipart upload) and `POST /assets/exports/from-url` (backend fetches the pandoc-generated URL and stores it). When a user clicks *Export* in the frontend, the app triggers a `from-url` persistence call in addition to the direct download. Artifacts are tracked in the `ExportArtifact` Mongo model and retrievable via `GET /assets/exports/:id` (authenticated).

### Compatibility and migrating external image links

- Existing articles that reference external URLs (Imgur, etc.) keep rendering unchanged — no forced rewrite.
- An opt-in script migrates external image references to platform assets:

```bash
cd graphql
# dry-run (no writes)
npm run migrate-images-to-assets:dry
# actual run
npm run migrate-images-to-assets
# restrict to specific hosts or articles
HOSTS=i.imgur.com,imgur.com ARTICLE_IDS=<id1>,<id2> npm run migrate-images-to-assets
```

The script downloads each image, uploads it to the object store, creates an `Asset` document, and replaces the external URL with `/assets/images/<id>` in `workingVersion.md`.

## Next steps

Once you have an up and running Stylo instance, read the [`SERVER.md` file](SERVER.md) to run daily and maintenance operations, such as database migrations and such.
