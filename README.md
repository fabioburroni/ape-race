# Ape Race – Corsa nei borghi

Gioco web 3D: corse di Ape Cross per le strade vere dei borghi toscani (Asciano e dintorni), con **multiplayer online** tra amici.

- Versione su claude.ai (solo giocatore singolo): https://claude.ai/artifact/XSWgTjNQcidHe3Uwi2QaWL
- Questa repository: la versione con server di gioco, per giocare online con chiunque apra il link (senza account).

## Cosa c'è

| Cartella / file | Contenuto |
|---|---|
| `client/index.html` | Il gioco completo (Three.js): Asciano da OpenStreetMap, 4 percorsi, giro libero, esplorazione col mouse, garage, turbo, spinta, record e fantasma, carico che cade, ostacoli |
| `client/net.js` | La parte online: lobby con codice, sincronizzazione delle Ape, partenza insieme, spinte tra giocatori, classifica comune |
| `server/server.js` | Server Node.js: serve i file del gioco e gestisce le partite via WebSocket (`/ws`) |
| `render.yaml` | Configurazione pronta per pubblicare il gioco gratis su Render |

## Provarlo sul proprio computer

Serve [Node.js](https://nodejs.org) 18 o più recente.

```bash
npm install
npm start
```

Poi apri http://localhost:8080 nel browser. Per provare l'online da solo, apri una seconda finestra (o un altro browser) sullo stesso indirizzo.

## Metterlo online gratis (Render)

1. Crea un account su https://render.com (puoi entrare con GitHub).
2. **New → Blueprint**, scegli la repository `ape-race`: Render legge `render.yaml` e crea il servizio da solo.
3. Dopo un paio di minuti il gioco è raggiungibile a un indirizzo tipo `https://ape-race.onrender.com`.

Note sul piano gratuito: dopo circa 15 minuti senza giocatori il server si addormenta; il primo che apre il link aspetta 30–50 secondi che si risvegli. Per giocare tra amici va benissimo.

## Come si gioca online

1. Dal menù: **🌐 Online con amici** → **Crea una partita**.
2. Compare un codice (es. `K7PX`) e un link da mandare agli amici: chi lo apre entra direttamente nella partita.
3. Chi ha creato la partita (👑) sceglie paese, percorso e quantità di ostacoli, poi preme **Parti!**.
4. Tutti partono insieme. Ci si può spingere (tasto E o 💥). Classifica comune all'arrivo, con le penalità per il carico perso.
5. Dalla classifica si torna alla lobby per un'altra gara.

Online non ci sono avversari del computer: solo giocatori veri (fino a 8 per partita).

## Come funziona la rete (in breve)

- Ogni browser calcola la guida della propria Ape e invia posizione, velocità e inclinazione circa 12 volte al secondo.
- Il server inoltra gli stati agli altri della stessa stanza; ognuno vede le Ape degli amici con un ritardo di circa 0,13 s, ammorbidito.
- Partenza e cronometro si basano sull'orologio del server, così i tempi sono confrontabili anche tra PC veloci e telefoni lenti.
- Gli ostacoli (trattori, buche, bancarelle, galline, gatti) usano lo stesso "seme" casuale per tutti: sono negli stessi punti.
- Le spinte tra giocatori: chi spinge invia l'evento, chi la subisce la applica alla propria Ape.

## Stato e prossimi passi

Versione **2.0.0-alpha.1** (primo prototipo online). Da fare:
- prova reale con 2–4 dispositivi (PC e telefoni) su Render
- gestione migliore di chi entra a gara iniziata (oggi aspetta in lobby la gara successiva)
- carico caduto visibile anche agli altri giocatori nello stesso punto
- Rapolano Terme e "Campionato dei borghi"

Il piano di sviluppo completo è nel progetto claude.ai "VIDEOGIOCHI".

## Crediti

- Strade, edifici e luoghi: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licenza ODbL
- Grafica 3D: [Three.js](https://threejs.org) (MIT)
- Rilievo del terreno, facciate e fontane: ricostruzioni approssimate fatte per il gioco
