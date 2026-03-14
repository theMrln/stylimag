# Configuration

## OJS (Open Journal Systems)

OJS credentials and endpoints are read from `config/ojs.json`. This file is **not** committed (see `.gitignore`).

1. Copy the example: `cp ojs.example.json ojs.json`
2. Edit `ojs.json` and set `api_endpoint` and `api_token` for each instance you use (`staging`, `production`).

The app supports two OJS instances (staging and production). Each has its own import button on the corpus page. Only instances that have valid `api_endpoint` and `api_token` in `ojs.json` are shown.

Compatible with **OJS 3.x and 3.5** (REST API; endpoint URLs may include `index.php` paths).
