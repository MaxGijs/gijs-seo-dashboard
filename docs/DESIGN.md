# Ontwerpsysteem Gijs Intelligence Center

Eén rustig systeem op basis van drie bronnen:

- **Gijs**: kleuren, lettertype (Open Sans) en toon.
- **Apple** ([claude-apple-design-system](https://github.com/rukkiecodes/claude-apple-design-system), MIT): rust, één accent, pil-knoppen, dunne lijnen, vaste maten, gewichten 400/600/700.
- **shadcn/ui**: de bouwstenen (knop, kaart, badge) en hun toegankelijkheid. Nieuwe schermen gebruiken `components/v2/ui`; bestaande schermen gebruiken dezelfde tokens via de klassen in `app/globals.css`. Beide lezen dezelfde `:root`-variabelen, zodat ze er hetzelfde uitzien.

## Elke pagina beantwoordt binnen tien seconden

1. **Wat zie ik?** De paginatitel en één zin met de conclusie.
2. **Is dit goed of vraagt het aandacht?** Een statusregel met een gekleurde stip (`PageHeader status`).
3. **Wat kan of moet ik nu doen?** Eén primaire knop rechtsboven of bij de eerste actie.

Vaste volgorde van boven naar beneden: **conclusie → belangrijkste cijfers → waarschuwingen → acties → verdieping**. Verdieping zit achter tabs, inklapbare blokken, het zijpaneel of een eigen pagina.

## Kleur

| Rol | Token | Gebruik |
|---|---|---|
| Merk, primaire actie | `--green-800` | Primaire knop, paginatitels |
| Accent (Gijs-groen) | `--accent-700` | Actieve navigatie, links, focus, positieve status. Niet als decoratie. |
| Goed | `--success` / `--success-bg` | Groei, geslaagd, in orde |
| Aandacht | `--warning` / `--warning-bg` | Oranje: herinneringen, daling die je moet bekijken |
| Probleem | `--error` / `--error-bg` | Rood: iets is kapot of gaat duidelijk mis |
| Informatief, te weinig data | `--info` / `--info-bg` | Grijs: wordt gemeten, nog onvoldoende data, uitleg |

Statuskleur alleen voor status. Iconen in titels zijn grijs, niet groen.

## Type

Open Sans. Gewichten alleen **400** (tekst), **600** (labels, nadruk), **700** (titels). Geen hoofdletterlabels; korte labels in gewone zinsopbouw.

| Rol | Grootte |
|---|---|
| Paginatitel | 28 px / 700 |
| Sectietitel | 18 px / 700 |
| Kaarttitel | 15–16 px / 700 |
| Tekst | 14 px / 400 |
| Bijschrift | 12–13 px |

## Vorm en ruimte

- Hoeken: 6 (klein), 10 (velden, tegels), 14 (kaarten, vensters), 20 (grote vlakken), pil (knoppen, chips, zoekveld).
- Randen: 1 px `--border` of `--border-subtle`. 2 px alleen voor selectie/focus.
- Schaduw: hooguit `--shadow-1` bij hover of op zwevende lagen (menu, venster, toast). Geen schaduw op gewone kaarten.
- Ruimte: veelvouden van 4; tussen secties 24–32 px; binnen een kaart 20 px.
- Kaarten alleen als ze iets echt groeperen. Een rij cijfers is één kaart met scheidingslijnen, geen zes losse kaarten.

## Knoppen

- **Primair** (`btn-primary` / `<Button>`): één per scherm, donkergroen, pil.
- **Secundair** (`btn-secondary` / `variant="outline"`): witte pil met dunne rand.
- **Rustig** (`btn-ghost` / `variant="ghost"`): tekstknop voor minder belangrijke acties.
- **Gevaarlijk** (`btn-danger`): alleen tekst in rood, nooit gevuld.
- Een knop zegt wat er gebeurt ("Taak toevoegen", niet "Opslaan" zonder context).

## Lege statussen en fouten

- Leeg onderdeel zonder actie: verbergen. Leeg met een zinvolle actie: compacte regel met die actie.
- Technische fouten, quota en koppelingen staan op **Datastatus**. Elders hooguit één regel met een link daarheen als cijfers daardoor onvolledig zijn.

## Adviezen

Elk advies toont: **waarom**, **bewijs** (data), **verwachte impact**, **inspanning**, **prioriteit** en **wat je concreet doet**. Bij lessen en adviezen staat de **betrouwbaarheid**: hoeveel bewijs, eerdere resultaten en onzekerheid.

## Wat het systeem zelf doet

Elke automatische wijziging (archiveren, samenvoegen, score bijstellen) is zichtbaar met wat er veranderde, waarom, en een knop om het terug te draaien. Content wordt nooit automatisch gepubliceerd: publiceren is altijd een handeling van een medewerker.

## Beweging en toegankelijkheid

- Overgangen 140–220 ms, geen verschuivende kaarten bij hover, geen glaseffecten.
- `prefers-reduced-motion` respecteren.
- Zichtbare focus (2 px Gijs-groen), contrast minstens 4,5:1 voor tekst, alles met het toetsenbord bedienbaar.
- Controleer op 1280×800 en 1440×900: conclusie, cijfers en eerste actie zichtbaar zonder scrollen.

## Welk bedieningselement waarvoor

- **Tabs** (`SectionTabs`): wisselen tussen onderdelen van dezelfde pagina (Verdieping, statussen van kansen).
- **Schakelaar** (`.seg`): weergave of periode van hetzelfde (Bord/Lijst, 7/28/90 dagen).
- **Chips** (`.chip`): filters. Actief = gevuld donkergroen.
- **Keuzelijst en zoekveld in een filterbalk**: pilvorm, 36 px hoog.
- **Rij cijfers**: één vlak met scheidingslijnen (`.metric-strip`, `.learn-stats`, Vandaag-strook).
