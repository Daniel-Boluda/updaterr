# Updaterr

*[English](README.md)*

Prochází knihovnu Radarru a Sonarru a hledá lepší verze toho, co už máš – nejdřív podle **jazyka zvuku**, pak
podle rozlišení. Hledaný jazyk dabingu si vybereš (čeština, slovenština, polština, němčina…) a k němu druhý jazyk
(obvykle originál, angličtina). Pořadí je **oba jazyky › jen dabing › jen druhý jazyk**, při stejném jazyku vyšší
rozlišení – pro češtinu tedy **CZ + EN › CZ › EN**. Příklady níže jsou s češtinou, platí pro jakýkoli jazyk.

Nalezené upgrady nabídne ke schválení (web / Telegram / ntfy), nebo je u hlídaných filmů a seriálů stáhne sám.
Umí i **doplnit chybějící zvukovou stopu** do stávajícího souboru (např. 4K EN + CZ dabing z jiného releasu),
s automatickou kontrolou synchronizace. Rozhraní je česky a anglicky.

## Rychlý start (Docker)

```bash
git clone https://github.com/<ty>/updaterr.git && cd updaterr
cp .env.example .env              # doplň adresy, API klíče a cesty
docker compose up -d --build
```

Otevři `http://<server>:5290` (port `UPDATERR_PORT`) a v **Nastavení → Jazyky** vyber jazyky (nebo je nastav
v `.env`: `PRIMARY_LANGUAGE=cs`, `SECOND_LANGUAGE=en`). Dokud není vybraný jazyk dabingu, knihovna se neprochází.

- `.env` – vše, co závisí na prostředí: port a adresa, URL a API klíče Radarru/Sonarru, cesty ke knihovně,
  qBittorrent, notifikace, heslo. Vzor: `.env.example`.
- `docker-compose.yaml` – obecná definice služby, žádné adresy ani cesty napevno.
- `docker-compose.override.yaml` – úpravy pro tvůj server (Docker síť s Radarrem/Sonarrem, `config.xml`
  s API klíči). Compose ho načte sám, git ho ignoruje. Vzor: `docker-compose.override.example.yaml`.
- `docker-compose.gpu.yaml` – volitelně grafická karta pro rozpoznání řeči.
- Zbytek (jazyky, intervaly, limity, seedy, slučování, automatika) v UI → **Nastavení**. Data: `data/state.json`.

Knihovna musí být v kontejneru pod **stejnou cestou** jako v Radarru, Sonarru a qBittorrentu (`MEDIA_HOST_DIR`
na hostiteli → `MEDIA_DIR` v kontejneru). Pracovní složka `STAGING_DIR` (donory a zálohy) má být uvnitř, ať jsou
zálohy hardlinky na stejném disku.

### Náhled jen pro čtení na jiném portu

Druhá instance vedle běžící – třeba na vyzkoušení nové verze nad skutečnou knihovnou:

```bash
mkdir -p data-preview && cp data/state.json data-preview/     # volitelně: začít z kopie dat (náhled zastavený)
docker compose -p updaterr-preview -f docker-compose.preview.yaml up -d --build
# → http://<server>:5291  (PREVIEW_PORT)
docker compose -p updaterr-preview -f docker-compose.preview.yaml down
```

S `READ_ONLY=true` jen čte knihovnu z Radarru/Sonarru: nic nehledá, nestahuje, neimportuje, nemaže ani neposílá
notifikace a knihovna je připojená jen pro čtení. Nastavení jde měnit (platí jen pro kopii dat).

## Jak to funguje

1. **Knihovna** – každou hodinu načte filmy a série. Skutečný jazyk zjišťuje ze **zvukových stop souboru**
   (MediaInfo z Radarru/Sonarru), ne z názvu. Když MediaInfo jazyk nezná (`und`), použije odhad z názvu a
   v UI to označí jako „odhad“.
2. **Hledání** – postupně (výchozí 1 položka / 90 s, ať indexery nezahltí) spouští interaktivní hledání
   v Radarru/Sonarru, tj. přes všechny indexery z Prowlarru. Pořadí: hlídané položky, nikdy nekontrolované,
   jen-EN, neznámé, jen-CZ. Co nic nenašlo, zkusí znovu za `recheckDays`.
3. **Vyhodnocení** – jazyk releasu čte z názvu podle českých zvyklostí (`(CZ/EN)`, `.CZ-FTU`, `CZ dabing`,
   `MultiDub`…) a pozná, že `CZ titulky` / `+ CZtitulky` / `CZ-Sub` jsou titulky, ne dabing. Release bez
   uvedeného jazyka = originální znění. U českých filmů je cílem samotné CZ. Vyřadí mrtvé torrenty (méně než
   3 seedy), CAM/TS/3D, releasy mimo rozlišení 720p–1080p, příliš velké releasy a „Unknown movie“.
   Pravidla kvality a custom formáty z Radarru/Sonarru **ignoruje** – to byla ta část, která nefungovala.
4. **Návrh** – až 5 kandidátů seřazených podle jazyka, jistoty, rozlišení a seedů. Schválíš na webu nebo
   tlačítkem v Telegramu. Tlačítka odkazují na konkrétní release, takže když se návrh mezitím přehledá,
   nestáhne se omylem jiný.
5. **Stažení** – když je výsledek hledání starší než 20 min, nejdřív znovu ověří, že torrent žije. Pak hlídá
   frontu:
   - **žádný pokrok 3 h** → odebrat z klienta, zablokovat a automaticky stáhnout dalšího kandidáta
     (max. 3 pokusy); pomalý, ale živý torrent se za mrtvý nepovažuje,
   - Radarr/Sonarr odmítne import, protože podle *svých* pravidel to „není upgrade“ → **vynutí ruční import**,
   - po importu **ověří zvukové stopy** nového souboru; když release o jazyku lhal, upozorní a release zablokuje,
   - když stahování selže nebo ho zrušíš, návrh se znovu otevře se zbylými kandidáty.

### Ověření jazyka poslechem

Značky jazyka ve stopách občas lžou – typicky soubory z YouTube mají českou stopu označenou jako `eng`.
Než Updaterr něco nabídne, „poslechne“ si stopy stávajícího souboru: z několika míst vezme 90 s zvuku,
detektor řeči (Silero VAD) vybere jen úseky, kde se mluví, a **Whisper** (`whisper.cpp`, model `base`, běží
lokálně v kontejneru) určí jazyk. Když se řeč jasně liší od značky (např. značka `eng`, slyšet čeština ve
všech úsecích), použije se jazyk podle poslechu a zbytečné návrhy zmizí. Čeština × slovenština se Whisperu
plete, tam platí značka. U seriálu se ověřují 3 epizody série. Trvá to asi 8 s na stopu.

- Čekající návrhy, které vznikly bez ověření, se ověří postupně na pozadí.
- V detailu položky je tlačítko **Ověřit jazyk poslechem** a výsledek pro každou stopu.
- Ověřuje se i po stažení, než se release označí, že o jazyku „lhal“.
- Vypnout jde v Nastavení → Co je upgrade → *Ověřovat jazyk poslechem*.

### Grafická karta (GPU)

Rozpoznání řeči (Whisper) umí běžet na grafické kartě přes **Vulkan** (`docker-compose.gpu.yaml`). Je to jediná
úloha, které GPU pomůže – měření synchronizace a slučování stop brzdí čtení z disku a dekódování zvuku, korelace
obálek trvá desítky ms. Ve Whisperu GPU zrychlí výpočet a hlavně uvolní procesor pro torrent klienta a mediální server,
takže jde použít i přesnější model **small** (líp rozezná češtinu a slovenštinu).

- Kontejner má `devices: /dev/dri` a `group_add: VIDEO_GID` (skupina, která na hostiteli vlastní `/dev/dri/*`,
  např. `video`). Obraz obsahuje ovladač Vulkan pro AMD (`mesa-vulkan-ati`).
- V obrazu jsou dvě binárky: `whisper-cli` (procesor) a `whisper-cli-vulkan`. Když GPU chybí nebo selže,
  výpočet převezme procesor a GPU se 30 min nezkouší.
- Nastavení → **Grafická karta**: zapnutí/vypnutí, výběr modelu (base / small) a tlačítko **Ověřit** – zkontroluje
  zařízení v kontejneru, oprávnění a ovladač Vulkan, pustí Whisper na testovací nahrávce a porovná výsledek
  i čas s procesorem. Stejné ověření proběhne při každém startu kontejneru (výsledek je v Logu a v Připojení).
- Zkompilované shadery se ukládají do `data/cache/mesa`, ať se nepřipravují po každém novém kontejneru znovu.

### Slučování zvukových stop (CZ + EN z dvou releasů)

Když máš třeba film jen s EN a existuje CZ release, Updaterr nabídne kromě výměny celého souboru i
**„Přidat CZ zvuk“** – obraz a ostatní stopy zůstanou ze stávajícího souboru. Nabízí se jen tehdy, když je
jazyk stávajícího souboru ověřený – ze značek stop (MediaInfo), nebo [poslechem](#ověření-jazyka-poslechem):

1. Stáhne „donor“ release **přímo do qBittorrentu** (kategorie `updaterr`, mimo Radarr), a z torrentu jen
   potřebné video (u seriálu jen chybějící epizody). Video se stahuje **od začátku** (sekvenčně) a po
   prvních ~48 MB se z něj přes ffprobe zjistí snímková frekvence – **zjevně jiná fps** (rozdíl nad 2 %, např.
   PAL 25 vs 23,976) donor odmítne hned (torrent smaže a zkusí dalšího kandidáta), ne až po stažení celého
   torrentu. Menší rozdíly nechá na úplnou kontrolu v bodě 3 (hlavička MKV bývá zaokrouhlená na celé ms).
   Pak se sekvenční stahování zase vypne.
2. Podle **skutečných zvukových stop** (ffprobe) ověří, že donor CZ opravdu obsahuje.
3. Zkontroluje snímkovou frekvenci (25 vs 23,976 fps by se rozjíždělo) a délku.
4. **Synchronizace**: na 8 místech filmu porovná „obálku“ zvuku (hudba a ruchy jsou v dabingu i originálu
   stejné) a najde posun. Pozná jiný střih i postupný drift a v tom případě nesloučí. Když přímé porovnání
   nestačí, použije EN stopu donoru jako prostředníka.
5. Sloučí `mkvmerge` (s nalezeným posunem, CZ jako výchozí stopa) a **výsledek znovu ověří** – délku, oba
   jazyky a synchronizaci přímo ve výsledném souboru. Stávající stopy bez značky nebo se špatnou značkou
   dostanou ve výsledku jazyk podle poslechu (u seriálu i neověřené epizody se stejnými stopami jako ověřené).
6. Původní soubor zazálohuje (hardlink; bez zálohy se nic nemění) a výsledek naimportuje přes Radarr/Sonarr.
   Zálohy jsou v `downloads/updaterr/backup/` – viz [Zálohy](#zálohy).

Test na reálném filmu: uměle posunutá CZ stopa o 1,2 s byla srovnána s přesností na 1 ms a CZ stopa
z jiného filmu byla odmítnuta. Vyžaduje `QBIT_PASSWORD` v `.env`.

### Synchronizace dabingu u souborů s CZ i EN

Soubory, které už CZ i EN stopu mají, se **postupně na pozadí** proměřují stejnou metodou jako při slučování
(CZ proti EN ve stejném souboru). Kontrola šetří disk: obě stopy čte jedním průchodem ffmpegu s nejnižší
prioritou, posun hledá jen v ±10 s a skončí, jakmile je výsledek jistý (typicky 5–6 míst po 80 s, tedy asi
7 % souboru). Mezi soubory dělá pauzu (`syncCheckPauseSec`, aspoň 3× délka měření) a během slučování nebo
opravy nečte vůbec. Výsledek je u položky (`syncCheck: { offsetMs, matched, at }`).

Posun nad `syncWarnMs` (výchozí 80 ms) se v **Knihovně** ukáže jako „CZ dabing posunutý o X ms“ (filtr
*Posunutý dabing*). V detailu položky je **Opravit synchronizaci** – jen po kliknutí a potvrzení:
CZ stopy se znovu změří na všech 8 místech, `mkvmerge --sync` je posune do nového souboru (obraz, titulky,
kapitoly i přílohy beze změny), výsledek se znovu změří (musí sedět na ±40 ms), originál se zazálohuje
hardlinkem do `downloads/updaterr/backup/` a nový soubor se naimportuje přes Radarr/Sonarr.
Ve filtru *Posunutý dabing* je navíc **Opravit vše**: založí opravu pro všechny zobrazené posunuté položky
(respektuje hledání a Filmy/Seriály), které zrovna nic nedělají; opravují se postupně po jedné.

Ověřeno na kopii *Iron Man 2*: CZ dabing −340 ms → po opravě +3 ms (shoda 8/8).

### Zálohy

Záložka **Zálohy** ukazuje původní soubory, které Updaterr nahradil při slučování zvuku nebo opravě
synchronizace (`downloads/updaterr/backup/<id úlohy>/`): ke které položce patří, kolik zabírají, kdy se smažou
a které soubory obsahují. Záloha vzniká jako hardlink, ale po importu Radarr/Sonarr originál z knihovny smaže,
takže pak záloha **zabírá plnou velikost** – přehled rozlišuje místo opravdu zabrané a sdílené s knihovnou.

- **Retence** (platí i pro stávající zálohy): *Smazat po N dnech* od dokončení úlohy (`keepBackupDays`, výchozí 7)
  a *Max. místo* (`maxBackupGB`, 0 = bez limitu) – nad limit se mažou nejstarší. Před uložením retence, která by
  něco hned smazala, se zobrazí seznam a potvrzení.
- U každé zálohy jde nastavit **vlastní termín** (30 / 90 dní, rok, natrvalo) nebo ji hned **smazat**.
  Zálohy s vlastním termínem limit velikosti nemaže.
- Po nepovedeném importu se záloha drží aspoň 30 dní a podle velikosti se nemaže. Záloha bez záznamu úlohy
  (např. po ztrátě `state.json`) se maže jen ručně. Úklid běží každých 10 minut.

### Hlídání filmů a seriálů

V **Knihovně** ikona oka (nebo detail položky). Hlídaná položka se kontroluje častěji (`watchIntervalDays`,
výchozí 2 dny) a nalezený jistý upgrade (min. `autoMinSeeders` seedů, ne horší rozlišení) **stáhne sama** –
dostaneš jen oznámení. U seriálu platí pro celý seriál, i pro série, které teprve přibudou. Automatický
upgrade jde v detailu vypnout – pak se jen častěji hledá a upgrade se nabídne ke schválení.

**Nové filmy a seriály** může hlídání zapnout samo: Nastavení → Procházení knihovny → *Hlídat nově přidané*
(`autoWatchNew`: *Nehlídat* – výchozí, *Hlídat a upgradovat samo*, *Hlídat, upgrade schválím*). Film nebo seriál,
který se v knihovně objeví poprvé (první stažený soubor), se začne hlídat – když se třeba stáhne jen v EN, dál se
hledá upgrade na všechny [hledané jazyky](#hledané-jazyky). U seriálu jen nový seriál (pak i jeho další série),
nová série už známého seriálu ne. Při prvním načtení knihovny se nehlídá nic a ručně nastavené hlídání se
nepřepisuje. Vypnout jde u každé položky v detailu.

### Hledané jazyky

V detailu položky → **Hledané jazyky**: *CZ + EN* (výchozí), *Jen CZ* nebo *Jen EN*. S jedním jazykem je cílem
mít ten jeden – ostatní se neřeší (u „Jen CZ“ se nenabízí EN release ani přidání EN stopy a CZ + EN není lepší
než samotné CZ). U seriálu platí pro celý seriál, i pro série, které teprve přibudou. Po změně se čekající
návrhy pročistí a položky se při dalším průchodu zkontrolují znovu.

### Hledaný formát videa

V detailu položky → **Formát videa**: *Neřešit* (výchozí), *H.265 / AV1* nebo *Jen AV1*. Když soubor má starší kodek
(podle MediaInfo, např. H.264), hledá se release se **stejným jazykem (nebo lepším) a stejným nebo vyšším
rozlišením** v hledaném kodeku – nabídne se jako *Novější formát*. Kodek releasu se čte z názvu (`x265`, `H.265`,
`HEVC`, `AV1`, `x264`…); release, který kodek neuvádí, se kvůli formátu nenabízí. Úrovně: starší (XviD, MPEG-2…)
› H.264 › H.265 / VP9 › AV1. Kontejner (MKV, MP4) se neřeší – na kvalitu obrazu nemá vliv.

- Jazyk má přednost: jazykový upgrade se nabídne i ve starším kodeku, jen s varováním „starší formát videa“ a
  v pořadí kandidátů jsou napřed ty v hledaném kodeku.
- Novější kodek = stejný obraz v menším souboru, ne automaticky lepší obraz. Přehrávač ho musí umět dekódovat,
  jinak ho mediální server převádí.
- Automaticky se novější formát stahuje jen u hlídaných položek s automatickým upgradem, ne podle nastavení
  „Stahovat bez ptaní“ pro celou knihovnu. Po importu se ověří kodek nového souboru; když release lhal, zablokuje se.
- U seriálu platí pro celý seriál (série se hodnotí podle nejhorší epizody). Kodek, který MediaInfo neuvádí, se neřeší.

### Seriály: balíky více sérií a sady epizod

- **Balíky více sérií** (`Mr. Robot S01-S04 (CZ/EN)`, `Peaky Blinders S01-S02 (CZ) / S03-S06 (EN)`) – rozsah sérií
  se čte z názvu (`S01-S04`, `S01.S02.S03`, `Season 1-4`, `1.-3. série`…), jazyk zvlášť pro každou část názvu.
  Balík se nabídne jako **jeden návrh pro všechny série, které zlepší**; série, které už jsou stejně dobré, se
  z balíku neimportují. Sonarr takové releasy odmítá, proto se stahují s ručně zadanými epizodami (override).
- **Sady epizod** – když série nemá použitelný balík, ale každá epizoda pod cílovou úrovní má živý lepší
  release, nabídne se celá sada jako jeden kandidát.
- Obojí je jen po schválení a jde vypnout v Nastavení.

### Zaseknuté torrenty v qBittorrentu

Nastavení → Stahování a import → *Fronta qBittorrentu* (výchozí vypnuto). Platí **pro všechny torrenty
v qBittorrentu**, i ty z Radarru/Sonarru. Torrent, který stojí bez spojení (`stalledDL`, magnet bez metadat)
déle než `qbitStallMin` (30 min), se zastaví a dostane štítek `updaterr-stalled`, aby uvolnil místo
ve frontě dalším. Každých `qbitStallRetryMin` (120 min) se zastavené znovu spustí: když se rozjedou, štítek
zmizí, když dál stojí, po `qbitStallMin` se zastaví znovu. Vynucené (force start) a ručně zastavené torrenty
se nechávají být. Po vypnutí se zastavené torrenty spustí a štítek se sundá. Vlastní pravidlo pro mrtvé
torrenty (`stallHours`, pak další kandidát) platí dál, zastavení ho neovlivní.

### Notifikační centrum

Zvonek v horní liště webu. Sbírá stejné události jako Telegram/ntfy – **i když Telegram ani ntfy nastavené
nejsou**: nové návrhy, automatické stažení a náhradní pokusy, dokončené upgrady, selhání, zablokované importy,
zálohy ke kontrole a chyby z Logu. Opakující se událost (např. nedostupný Radarr) se do 6 h sloučí do jedné
položky s počtem. Počet nepřečtených je na zvonku i v titulku záložky prohlížeče; nové oznámení se při otevřené
stránce ukáže i jako krátká bublina.

- Kliknutí vede na místo: čekající návrh → Návrhy, stahování/sloučení/oprava → rozbalený řádek v Aktivitě,
  jinak detail položky, zálohy → Zálohy, chyba → Log. Tím se oznámení označí jako přečtené.
- Filtr *Vše / Nepřečtené / Problémy*, *Vše přečteno*, *Smazat přečtené* a mazání jednotlivých oznámení.
- Uchovává se posledních 300 oznámení, nejdéle 60 dní (`state.json` → `notifications`).
- Návrhy se do centra dostanou podle stejného nastavení jako do Telegramu (`notifyProposals`), události
  stahování a záloh vždy.

## Nastavení

### qBittorrent (pro slučování stop)
Do `.env` doplň `QBIT_URL=…` a `QBIT_PASSWORD=…` (případně `QBIT_USERNAME`, výchozí `admin`) a `docker compose up -d`.
V Nastavení pak u qBittorrentu uvidíš verzi.

### Telegram (doporučeno – tlačítka „Stáhnout“ přímo ve zprávě)
1. U [@BotFather](https://t.me/BotFather) založ bota → token.
2. Napiš botovi cokoli, pak zjisti chat id (`https://api.telegram.org/bot<TOKEN>/getUpdates` nebo @userinfobot).
3. Do `.env`: `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_CHAT_ID=…` a `docker compose up -d`.

Bot používá long-polling, takže nepotřebuje veřejnou adresu.

### Okamžitá kontrola nově stažených
Radarr i Sonarr → *Settings → Connect → + → Webhook*, zaškrtnout **On File Import** a **On File Upgrade**:
- Radarr: `http://updaterr:8080/api/webhook/radarr`
- Sonarr: `http://updaterr:8080/api/webhook/sonarr`

(`updaterr` = název kontejneru ve společné Docker síti; jinak adresa serveru a `UPDATERR_PORT`.)
S `WEBHOOK_TOKEN` v `.env` přidej `?token=…`.

### Automatika pro celou knihovnu
Výchozí je **vždy se ptát**. V Nastavení jde zapnout „Jen jisté cílové verze“ (oba jazyky) nebo „Jakýkoli jistý upgrade“.
Jemnější je hlídání jednotlivých položek (viz výše).

## Omezení

- Balíky bez čísel sérií v názvu („Complete Series“) a releasy, které Sonarr nevyparsuje, se nenabízejí.
- Jazyk kandidáta se odhaduje z názvu – `MULTI` bez dalšího je „odhad“, `.CZ-FTU` se bere jen jako CZ
  (i když často obsahuje i EN). Po stažení se to vždy ověří ze zvukových stop.
- Slučování nepřekódovává – donor s jinou snímkovou frekvencí (PAL 25 fps) se odmítne, zjevné případy už ze
  začátku staženého souboru.
- Pokud má film v Radarru profil s upgrady a Updaterr do něj dá třeba CZ 720p místo EN 1080p, Radarr se ho
  může později pokusit „upgradovat“ zpátky. Pomůže vypnout upgrady v profilu, nebo použít slučování stop.

## Vývoj

```bash
npm test                      # testy parseru jazyků, kodeků, sérií, kandidátů, stahování, slučování, hlídání, synchronizace dabingu a záloh
docker compose up -d --build  # nasazení
```

Bez npm závislostí – jen Node.js 22+, ffmpeg, mkvtoolnix a whisper.cpp (v kontejneru, i s Vulkanem pro GPU).
Image je na čistém Alpine: Node.js z balíků, ffmpeg sestavený jen se součástmi, které aplikace používá,
a modely Whisperu v kvantizaci q8_0 (stejné výsledky jako plné modely, poloviční velikost).

## Jazyky a překlady

Vestavěných je asi 50 jazyků (`src/languages.js`): kódy ISO 639-1/639-2, názvy z Radarru/Sonarru a slova, kterými
jazyk zmiňují názvy releasů (včetně slov pro dabing a titulky, např. `Lektor`/`Napisy` u polštiny, `VFF`/`VOSTFR`
u francouzštiny, `DL` u němčiny). **Místní indexery** (Nastavení) jsou trackery, jejichž releasy „MULTI“ nejspíš
obsahují i hledaný jazyk – pro češtinu třeba `sktorrent,trezzor,cztorrent`.

Texty rozhraní jsou v `public/locales/<jazyk>.json`, texty serveru (log, notifikace, chyby) v `src/locales/<jazyk>.json`.
Nový jazyk = zkopírovat `en.json` pod nový kód v obou složkách a přeložit.

## Licence

[MIT](LICENSE)
