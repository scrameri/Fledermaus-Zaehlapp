# Fledermaus-Zaehlapp

Offline-Webapp (PWA) zum Zaehlen ausfliegender Fledermaeuse vor einer Kolonie.
Laeuft im Handy-Browser, ohne Server, ohne Internet. Daten bleiben lokal auf
dem Geraet; Export als strukturiertes Excel (Grundlage fuer die manuelle Eingabe
in die nationale Datenbank und fuer die statistische Modellierung).

## Bedienung

1. Neue Zaehlung: Ort, Art, Datum, Beobachter/-in waehlen, dann "Zaehlung starten"
   (Startzeit wird automatisch erfasst).
2. Zaehlen:
   - **+1 Ausflug**: ein Tier fliegt aus.
   - **-1 Einflug**: ein Tier fliegt wieder ein (biologisches Ereignis, kein Doppel zaehlen).
   - **Korrektur (Fehlzaehlung)**: macht den letzten gueltigen Klick rueckgaengig
     (bleibt zur Nachvollziehbarkeit als ungueltig im Export erhalten).
   - Live-Hinweis zeigt, wann man aufhoeren kann (Variante in den Einstellungen).
3. Beenden: Endzeit wird erfasst, Resultat mit Kurven erscheint. Start-/Endzeit
   lassen sich korrigieren. Excel exportieren.

## Live-Schaetzung (umschaltbar in den Einstellungen)

- **Stille-Regel**: Stopp-Empfehlung, wenn seit dem letzten Ausflug X Minuten
  vergangen sind (Schwelle einstellbar).
- **Raten-basiert**: Stopp, wenn die Ausflugrate unter einen Anteil der
  bisherigen Spitzenrate faellt.
- **Kurven-Fit**: logistische Saettigungskurve, Restzeit bis ein eingestellter
  Anteil ausgeflogen ist; schaetzt zugleich die Koloniegroesse.

Die seriose Modellierung erfolgt bewusst separat (z.B. in R) auf Basis des
Ereignis-Exports.

## Excel-Export

Zwei Blaetter:
- **Zaehlungen**: Metadaten und Resultat je Session.
- **Ereignisse**: eine Zeile je Klick, sekundengenauer Zeitstempel, Typ,
  Gueltig-Flag, laufender Saldo.

## Referenzlisten erweitern

`js/data.js` editieren (Orte, Arten, Beobachter).

## Lokal testen

Statisch ausliefern, z.B.:

```
python3 -m http.server 8000
```

dann `http://localhost:8000` oeffnen. Fuer die Installation auf dem Handy muss
die Seite ueber HTTPS (oder localhost) bereitgestellt werden.

## Technik

Reines HTML/CSS/JS, Service Worker fuer Offline, IndexedDB fuer Daten,
SheetJS (vendored in `lib/`) fuer den Excel-Export. Charts sind eigenes SVG
(keine externe Lib).
