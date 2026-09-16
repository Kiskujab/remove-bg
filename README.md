# Színolló

Szín alapú háttéreltávolító, ami teljesen a böngészőben fut. Nincs backend, nincs build lépés, nincs külső kérés.

## Futtatás helyben

```bash
python3 -m http.server 8347
```

Utána: http://localhost:8347

Az `index.html` dupla kattintással (`file://`) is megnyílik, de ilyenkor a böngésző nem enged Web Workert, így a számolás a fő szálon fut, és nagy képeknél akadhat.

## Kiadás GitHub Pagesre

A mappa tartalmát egy repó gyökerébe kell tenni, majd: *Settings → Pages → Deploy from a branch → main / root*. Build nem kell.

## Felépítés

| Fájl | Szerep |
| --- | --- |
| `js/core.js` | CIELAB színtávolság (ΔE76), maszk, alfa – DOM nélkül, a worker és az oldal is ezt tölti be |
| `js/worker.js` | Web Worker: előnézet és teljes felbontású kivágás |
| `js/engine.js` | Worker-híd; ha nincs worker, ugyanaz a kód a fő szálon fut |
| `js/media.js` | Fájlbeolvasás %-kal, dekódolás, vászonkorlátok, kompozitálás, export |
| `js/demo.js` | Az élő minta a bemutató oldalon |
| `js/app.js` | Lépések és felület |

### Hogyan számol

- Pipettázáskor a teljes felbontású képből olvassuk ki a pontos RGB-t.
- A csúszka mozgatásakor csak egy ≤ 2000 px-es előnézet frissül a workerben (nearest-neighbour mintavétel, így a „pontosan egyező szín” itt is valódi pixelszín). A worker ugyanazt a puffert kapja vissza és adja tovább, a kérések összevonódnak, tehát nem torlódnak fel.
- A „Tovább” gombra egyszer fut le a teljes felbontású kivágás.
- A tűrés skálája a képen mért legnagyobb távolsághoz igazodik: 0 = csak a pontos szín, 100 = minden pixel.
- A 90°-os forgatás pixelpontos (egész mátrix, simítás nélkül), tetszőleges szögnél a vászon a forgatott kép köré bővül.

## Betűk

Young Serif, Schibsted Grotesk, Martian Mono – helyben tárolva, latin + latin-ext részhalmaz (ő, ű). Licenc: `fonts/FONTS-LICENSE.txt` (SIL OFL 1.1).
