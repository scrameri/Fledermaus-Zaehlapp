# Deployment (HTTPS)

Die App ist eine statische PWA. Fuer die Installation auf dem Handy braucht es
HTTPS (sonst startet der Service Worker / die Installation nicht). Empfohlen:
GitHub Pages, kostenlos und mit fester URL.

## Variante A: GitHub Pages (empfohlen)

Die Auslieferung ist ueber `.github/workflows/deploy.yml` automatisiert: jeder
Push auf `main` baut und veroeffentlicht den Repo-Inhalt auf Pages.

Einmalige Einrichtung:

1. Remote-Repo anlegen und pushen (mit GitHub CLI):

   ```sh
   gh repo create Fledermaus-Zaehlapp --public --source=. --remote=origin --push
   ```

   (oder `--private`; Pages funktioniert auch bei privaten Repos im Free-Plan).

2. Pages auf "GitHub Actions" stellen:

   ```sh
   gh api -X POST repos/<user>/Fledermaus-Zaehlapp/pages \
     -f build_type=workflow
   ```

   oder im Browser: Repo -> Settings -> Pages -> Source: "GitHub Actions".

3. Der Workflow laeuft beim naechsten Push automatisch. Die URL erscheint unter
   Actions -> Deploy -> "github-pages" bzw. Settings -> Pages. Form:
   `https://<user>.github.io/Fledermaus-Zaehlapp/`

4. Auf dem Handy diese URL oeffnen, dann "Zum Startbildschirm hinzufuegen".
   Danach laeuft die App offline.

Pfade sind relativ (`manifest.webmanifest` `scope`/`start_url` = `./`), daher
funktioniert die Auslieferung auch im Unterpfad `/<repo>/` ohne Anpassung.

## Variante B: Netlify (Drag & Drop)

Ordner auf https://app.netlify.com/drop ziehen. Sofort eine HTTPS-URL, kein
Build noetig. Updates wieder per Drag & Drop oder via `netlify deploy`.

## Variante C: Lokal mit HTTPS (Feldtest ohne Internet)

Selbstsigniertes Zertifikat, dann im WLAN am Handy oeffnen:

```sh
# einmalig Zertifikat erzeugen (mkcert macht es vertrauenswuerdig)
brew install mkcert && mkcert -install && mkcert localhost 192.168.x.x

# ausliefern (z.B. mit dem npm-Paket "http-server")
npx http-server -S -C localhost.pem -K localhost-key.pem -p 8443
```

Dann am Handy `https://<rechner-ip>:8443` oeffnen. Das selbstsignierte Zert
muss man am Handy ggf. einmal akzeptieren.
