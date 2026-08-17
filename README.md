# Quizzine

Searchable quiz-deck library for Quiz Club, VSSUT Burla. The static site lives at the repository root and its source decks are stored in `public/quizzes/`.

## Deployment

Every push to `main` invokes `.github/workflows/deploy.yml`. Configure these repository secrets once for the DigitalOcean VPS:

- `QUIZZINE_VPS_HOST`
- `QUIZZINE_VPS_USER`
- `QUIZZINE_VPS_SSH_KEY`
- `QUIZZINE_VPS_PATH` (for example `/var/www/quizzine`)
- `QUIZZINE_VPS_DEPLOY_COMMAND` (for example `sudo systemctl reload caddy`)

The VPS web server should serve `QUIZZINE_VPS_PATH` for the purchased domain.
