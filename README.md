# Technical Difficulties 🛻💥

A **reverse tower defense** game about technicals — improvised fighting
vehicles with entirely unreasonable weapons bolted on top.

In a normal tower defense, the towers shoot and the creeps walk.
Here it's the other way around: **your vehicles drive the road and do the
shooting**, while the enemy's bunkers, watchtowers and mortar pits sit
still and shoot back.

## The fleet

| Vehicle | Armament | Notes |
| --- | --- | --- |
| Pickup Truck | Twin machine guns | The original technical |
| Pizza Moped | Recoilless rifle | 30 minutes or the next warhead is free |
| Ice-Cream Van | DShK | The jingle is the last thing they hear |
| Farm Tractor | Battleship cannon | Ploughs fields, flattens bunkers |
| School Bus | Quad rocket pods | Please remain seated |
| Bicycle | Tank turret | Zero to 125mm in fourteen pedal strokes |
| Tuk-Tuk | Rocket battery | The suspension filed a formal complaint |

## How to play

- Buy technicals from **The Garage** — they spawn at the road entrance,
  drive the route on their own, and open fire on any fortification in range.
- Destroyed fortifications pay **bounties**; vehicles that survive to the end
  of the road bring home **salvage**.
- Every technical you lose costs **morale**. At zero morale, game over.
- Hotkeys: `1`–`7` deploy vehicles, `Space` starts the next wave.
- Waves scale forever. See how far the convoy gets.

## Running it

It's a static site with zero dependencies — just open `index.html` in a
browser, or serve the folder:

```sh
python3 -m http.server 8080
# then visit http://localhost:8080
```

Works great on GitHub Pages too: enable Pages for this branch and point it
at the repository root.

### Docker

```sh
docker compose up
# then visit http://localhost:8082
```

This builds a tiny nginx-alpine image that serves the static files on
port **8082**. Add `-d` to run detached; `docker compose down` to stop.

## Tech

Plain HTML/CSS/JavaScript on a `<canvas>`. All the vehicle art is drawn
with canvas primitives, the sound effects are synthesized with the Web Audio
API, and there are no build steps, frameworks, or assets to download.
